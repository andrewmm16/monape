import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  challengeHash,
  CHALLENGE_MAX_AGE_MS,
  CHALLENGE_MIN_AGE_MS,
  issueChallenge,
  verifyChallenge,
} from "@/modules/online-apply/challenge";
import { portalFromReferrer } from "@/modules/online-apply/origin";
import { isValidSolution, leadingZeroBits, POW_BITS, sha256Text, solveChallenge } from "@/modules/online-apply/pow";
import { onlineApplicationSchema } from "@/modules/online-apply/schema";
import { clientIp, normalizeIp, rateLimitSubject } from "@/modules/online-apply/subject";
import { makeDocx, makePdf } from "../fixtures/documents";

const SECRET = "secreto-ficticio-del-formulario-0123456789abcdef";
const CODE = "abc123def4";
const NOTICE_ID = "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10";

const mocks = vi.hoisted(() => ({
  enabled: true,
  calls: [] as string[],
  rpcArgs: [] as { name: string; args: Record<string, unknown> }[],
  rpcResults: {} as Record<string, { data: unknown; error: { code: string } | null }>,
  resumeRegistered: false,
  savedApplication: null as { id: string; public_reference: string } | null,
  headers: {} as Record<string, string>,
  after: [] as (() => Promise<void>)[],
  adminCreated: 0,
  evaluate: vi.fn(),
  ocr: vi.fn(),
  scanned: false,
  removed: [] as string[][],
  vacancy: { acceptingApplications: true } as { acceptingApplications: boolean } | null,
  noticeId: "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10" as string | null,
  rpcThrows: false,
}));

vi.mock("@/modules/online-apply/config", () => ({
  getOnlineApplyConfig: () => (mocks.enabled ? { enabled: true, secret: SECRET } : { enabled: false }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers(mocks.headers) }));
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    mocks.calls.push("after");
    mocks.after.push(callback);
  },
}));
vi.mock("@/modules/public-jobs/queries", () => ({
  getPublicVacancy: async () => {
    mocks.calls.push("vacancy");
    return mocks.vacancy;
  },
}));
vi.mock("@/modules/privacy/queries", () => ({
  getCurrentPrivacyNotice: async () => {
    mocks.calls.push("notice");
    return mocks.noticeId ? { id: mocks.noticeId, version: 3, title: "t", body: "b", effectiveFrom: "2026-01-01" } : null;
  },
}));
vi.mock("@/modules/evaluation/service", () => ({
  evaluateApplication: (...args: unknown[]) => mocks.evaluate(...args),
}));
vi.mock("@/modules/resumes/extraction", () => ({
  EXTRACTOR_VERSION: "extractor-v1",
  needsOcr: () => mocks.scanned,
  extractResume: async () => {
    mocks.calls.push("extract");
    return {
      status: mocks.scanned ? "sin_texto" : "completada",
      method: "pdf_text",
      extractorVersion: "extractor-v1",
      text: "Texto ficticio del CV",
      warnings: [],
      errorCode: null,
      suggestions: { skills: [], version: "s1" },
    };
  },
}));
vi.mock("@/modules/resumes/ocr-apply", () => ({
  applyOcrToResume: async (...args: unknown[]) => {
    mocks.calls.push("ocr");
    return mocks.ocr(...args);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    mocks.adminCreated++;
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        mocks.calls.push(`rpc:${name}`);
        mocks.rpcArgs.push({ name, args });
        if (mocks.rpcThrows && name === "submit_online_application") throw new Error("red caída");
        return mocks.rpcResults[name] ?? { data: null, error: null };
      },
      from: (table: string) => {
        const query: Record<string, unknown> = {};
        query.select = () => query;
        query.eq = () => query;
        query.maybeSingle = async () => ({
          data: table === "resumes" ? (mocks.resumeRegistered ? { id: "x" } : null) : mocks.savedApplication,
          error: null,
        });
        return query;
      },
      storage: {
        from: () => ({
          upload: async () => {
            mocks.calls.push("upload");
            return { error: null };
          },
          remove: async (paths: string[]) => {
            mocks.calls.push("remove");
            mocks.removed.push(paths);
            return { error: null };
          },
        }),
      },
    };
  },
}));

const { submitOnlineApplication } = await import("@/modules/online-apply/actions");

describe("prueba de trabajo (SHA-256 del navegador)", () => {
  it("el SHA-256 de JavaScript coincide con el de Node (mensajes cortos, de varios bloques y con acentos)", () => {
    for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(200), "Postulación — ñandú ✓"]) {
      expect(Buffer.from(sha256Text(text)).toString("hex"), text).toBe(createHash("sha256").update(text).digest("hex"));
    }
  });

  it("cuenta los bits en cero iniciales", () => {
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x7f]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x80]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x01]))).toBe(23);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16);
  });

  it("solveChallenge halla una solución con 16 bits en cero y cede el hilo entre tandas", async () => {
    const { challenge, bits } = issueChallenge(SECRET, CODE);
    expect(bits).toBe(POW_BITS);
    const solution = await solveChallenge(challenge, bits);
    const digest = createHash("sha256").update(`${challenge}:${solution}`).digest();
    expect(digest[0]).toBe(0);
    expect(digest[1]).toBe(0);
    expect(isValidSolution(challenge, solution, bits)).toBe(true);
    expect(isValidSolution(challenge, `${solution}x`, bits)).toBe(false);
  });

  it("se puede cancelar", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(solveChallenge("x", 40, controller.signal)).rejects.toThrow();
  });
});

describe("desafío firmado", () => {
  const issuedAt = 1_800_000_000_000;

  async function solved(now: number, code = CODE) {
    const { challenge, bits } = issueChallenge(SECRET, code, issuedAt);
    return { challenge, solution: await solveChallenge(challenge, bits), now };
  }

  it("acepta un desafío válido entre 3 segundos y 30 minutos y devuelve su hash", async () => {
    const { challenge, solution } = await solved(0);
    const check = verifyChallenge(SECRET, CODE, challenge, solution, issuedAt + CHALLENGE_MIN_AGE_MS + 1000);
    expect(check).toEqual({ ok: true, hash: challengeHash(challenge) });
    expect(challengeHash(challenge)).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChallenge(SECRET, CODE, challenge, solution, issuedAt + CHALLENGE_MAX_AGE_MS).ok).toBe(true);
  });

  it("rechaza uno demasiado reciente y uno vencido", async () => {
    const { challenge, solution } = await solved(0);
    expect(verifyChallenge(SECRET, CODE, challenge, solution, issuedAt + CHALLENGE_MIN_AGE_MS - 1)).toEqual({
      ok: false,
      reason: "demasiado_reciente",
    });
    expect(verifyChallenge(SECRET, CODE, challenge, solution, issuedAt + CHALLENGE_MAX_AGE_MS + 1)).toEqual({
      ok: false,
      reason: "vencido",
    });
  });

  it("rechaza una firma alterada, otra clave o un desafío manipulado", async () => {
    const { challenge, solution } = await solved(0);
    const now = issuedAt + 10_000;
    expect(verifyChallenge("otro-secreto-ficticio-0123456789abcdef-xyz", CODE, challenge, solution, now)).toEqual({
      ok: false,
      reason: "firma",
    });
    const tampered = challenge.replace(`.${issuedAt}.`, `.${issuedAt - 60_000}.`);
    expect(verifyChallenge(SECRET, CODE, tampered, solution, now)).toEqual({ ok: false, reason: "firma" });
    const lowered = challenge.replace(/\.16\./, ".1.");
    expect(verifyChallenge(SECRET, CODE, lowered, "0", now)).toEqual({ ok: false, reason: "firma" });
    expect(verifyChallenge(SECRET, CODE, `${challenge}x`, solution, now).ok).toBe(false);
    expect(verifyChallenge(SECRET, CODE, "basura", solution, now)).toEqual({ ok: false, reason: "formato" });
  });

  it("rechaza el desafío de otra vacante", async () => {
    const { challenge, solution } = await solved(0, "zzzzzzzzzz");
    expect(verifyChallenge(SECRET, CODE, challenge, solution, issuedAt + 10_000)).toEqual({ ok: false, reason: "vacante" });
  });

  it("rechaza una solución que no tiene los bits en cero", async () => {
    const { challenge, solution } = await solved(0);
    const wrong = isValidSolution(challenge, "zz", POW_BITS) ? "zy" : "zz";
    expect(verifyChallenge(SECRET, CODE, challenge, wrong, issuedAt + 10_000)).toEqual({ ok: false, reason: "solucion" });
    expect(solution).not.toBe(wrong);
  });

  it("cada desafío lleva un nonce distinto", () => {
    expect(issueChallenge(SECRET, CODE, issuedAt).challenge).not.toBe(issueChallenge(SECRET, CODE, issuedAt).challenge);
  });
});

describe("IP y límite", () => {
  it("toma el primer valor de x-forwarded-for o, si falta, x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers({ "x-forwarded-for": " ", "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("");
  });

  it("el sujeto es un HMAC hexadecimal de 64 caracteres que no contiene la IP", () => {
    const subject = rateLimitSubject(SECRET, new Headers({ "x-forwarded-for": "203.0.113.9" }));
    expect(subject).toBe(createHmac("sha256", SECRET).update("ip:203.0.113.9").digest("hex"));
    expect(subject).toMatch(/^[0-9a-f]{64}$/);
    expect(subject).not.toContain("203");
    expect(rateLimitSubject("otro-secreto-ficticio-0123456789abcdef-xyz", new Headers({ "x-forwarded-for": "203.0.113.9" }))).not.toBe(
      subject,
    );
  });
});

describe("sujeto de IP: normalización", () => {
  const subjectOf = (ip: string) => rateLimitSubject(SECRET, new Headers({ "x-forwarded-for": ip }));
  const hmac = (value: string) => createHmac("sha256", SECRET).update("ip:" + value).digest("hex");

  it("IPv6 se agrupa por /64: mismo prefijo, mismo sujeto; otro prefijo, otro", () => {
    expect(subjectOf("2001:db8:abcd:12::1")).toBe(subjectOf("2001:0db8:abcd:0012:ffff:eeee:dddd:cccc"));
    expect(subjectOf("2001:db8:abcd:12::1")).toBe(hmac("2001:db8:abcd:12::/64"));
    expect(subjectOf("2001:db8:abcd:13::1")).not.toBe(subjectOf("2001:db8:abcd:12::1"));
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("IPv4 mapeada en IPv6 equivale a la IPv4; con puerto también", () => {
    expect(subjectOf("::ffff:203.0.113.9")).toBe(subjectOf("203.0.113.9"));
    expect(subjectOf("::ffff:cb00:7109")).toBe(subjectOf("203.0.113.9"));
    expect(subjectOf("203.0.113.9:5555")).toBe(subjectOf("203.0.113.9"));
    expect(subjectOf("203.0.113.9")).toBe(hmac("203.0.113.9"));
  });

  it("sin IP usa el sujeto compartido sin-ip; un valor irreconocible se conserva", () => {
    expect(rateLimitSubject(SECRET, new Headers())).toBe(hmac("sin-ip"));
    expect(normalizeIp("no-es-ip")).toBe("no-es-ip");
  });
});

describe("origen", () => {
  it("Google solo para dominios google.<tld>; el resto, «Página de empleos»", () => {
    for (const referrer of [
      "https://www.google.com/",
      "https://google.com/search?q=empleo",
      "https://www.google.com.pe/",
      "https://google.co.uk/",
      "https://www.google.pe/url?q=x",
    ]) {
      expect(portalFromReferrer(referrer), referrer).toBe("Google");
    }
    for (const referrer of [
      "",
      null,
      undefined,
      "no es una url",
      "https://notgoogle.com/",
      "https://google.evil.com/",
      "https://www.bing.com/",
      "https://www.linkedin.com/jobs",
      "https://empresa.test/empleos",
      "javascript:alert(1)",
      `https://www.google.com/${"a".repeat(3000)}`,
    ]) {
      expect(portalFromReferrer(referrer), String(referrer)).toBe("Página de empleos");
    }
  });
});

describe("datos del formulario", () => {
  const base = {
    fullName: "Ana Pérez Ficticia",
    email: "Ana@Correo.Test",
    phone: "+51 999 111 222",
    location: "",
    linkedinUrl: "",
    acceptNotice: true,
    acceptTalentPool: false,
    noticeId: NOTICE_ID,
  };

  it("normaliza y deja ciudad y LinkedIn opcionales", () => {
    expect(onlineApplicationSchema.parse(base)).toMatchObject({
      email: "ana@correo.test",
      location: null,
      linkedinUrl: null,
      acceptTalentPool: false,
    });
  });

  it("exige nombre, correo, teléfono, casilla del aviso e id del aviso", () => {
    const fields = (input: object) => {
      const result = onlineApplicationSchema.safeParse({ ...base, ...input });
      return result.success ? [] : result.error.issues.map((issue) => String(issue.path[0]));
    };
    expect(fields({ fullName: "A" })).toEqual(["fullName"]);
    expect(fields({ email: "" })).toEqual(["email"]);
    expect(fields({ email: "no-es-correo" })).toEqual(["email"]);
    expect(fields({ phone: "" })).toEqual(["phone"]);
    expect(fields({ acceptNotice: false })).toEqual(["acceptNotice"]);
    expect(fields({ noticeId: "x" })).toEqual(["noticeId"]);
    expect(fields({ linkedinUrl: "http://linkedin.com/in/x" })).toEqual(["linkedinUrl"]);
  });
});

describe("Server Action submitOnlineApplication", () => {
  let pdf: Uint8Array;
  let challenge: string;
  let solution: string;

  async function freshChallenge(code = CODE, ageMs = 10_000) {
    const issued = issueChallenge(SECRET, code, Date.now() - ageMs);
    return { challenge: issued.challenge, solution: await solveChallenge(issued.challenge, issued.bits) };
  }

  function form(overrides: Record<string, string | File | null> = {}): FormData {
    const data = new FormData();
    const values: Record<string, string | File | null> = {
      vacancyCode: CODE,
      challenge,
      solution,
      noticeId: NOTICE_ID,
      fullName: "Ana Pérez Ficticia",
      email: "ana@correo.test",
      phone: "+51 999 111 222",
      location: "Lima",
      linkedinUrl: "",
      acceptNotice: "on",
      acceptTalentPool: "on",
      referrer: "",
      website: "",
      cv: new File([pdf as BlobPart], "cv.pdf", { type: "application/pdf" }),
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) if (value !== null) data.set(key, value);
    return data;
  }

  const lastArgs = (name: string) => mocks.rpcArgs.filter((call) => call.name === name).at(-1)?.args;

  beforeEach(async () => {
    pdf ??= await makePdf(["Ana Pérez Ficticia", "Analista con experiencia en SQL y reportes de gestión."]);
    ({ challenge, solution } = await freshChallenge());
    mocks.enabled = true;
    mocks.calls.length = 0;
    mocks.rpcArgs.length = 0;
    mocks.after.length = 0;
    mocks.removed.length = 0;
    mocks.adminCreated = 0;
    mocks.evaluate.mockReset().mockResolvedValue("eval-id");
    mocks.ocr.mockReset().mockResolvedValue({ attempted: true, applied: true, status: "completada" });
    mocks.scanned = false;
    mocks.resumeRegistered = false;
    mocks.savedApplication = null;
    mocks.vacancy = { acceptingApplications: true };
    mocks.noticeId = NOTICE_ID;
    mocks.rpcThrows = false;
    mocks.headers = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
    mocks.rpcResults = {
      consume_public_rate_limit: { data: true, error: null },
      consume_form_challenge: { data: true, error: null },
      submit_online_application: { data: [{ application_id: "app-1", public_reference: "ABCD2345" }], error: null },
    };
  });

  it("ejecuta los pasos en orden y evalúa por reglas después de responder", async () => {
    const result = await submitOnlineApplication(form());
    expect(result).toEqual({ ok: true, reference: "ABCD2345" });
    expect(mocks.calls).toEqual([
      "rpc:consume_form_challenge",
      "vacancy",
      "notice",
      "rpc:consume_public_rate_limit",
      "extract",
      "upload",
      "rpc:submit_online_application",
      "after",
    ]);
    expect(mocks.evaluate).not.toHaveBeenCalled();
    await mocks.after[0]!();
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.anything(), "app-1", "reglas", { system: true });

    const args = lastArgs("submit_online_application")!;
    expect(args).toMatchObject({
      p_vacancy_code: CODE,
      p_notice_id: NOTICE_ID,
      p_portal_name: "Página de empleos",
      p_accept_talent_pool: true,
      p_email: "ana@correo.test",
      p_city: "Lima",
      p_linkedin_url: null,
      p_mime_type: "application/pdf",
    });
    expect(args.p_storage_path).toMatch(/^candidates\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
    expect(args.p_sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
  });

  it("PDF sin texto: el OCR corre después de responder y antes de evaluar", async () => {
    mocks.scanned = true;
    expect((await submitOnlineApplication(form())).ok).toBe(true);
    // Sin OCR en la solicitud: solo se programa.
    expect(mocks.calls).not.toContain("ocr");
    await mocks.after[0]!();
    expect(mocks.ocr).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^[0-9a-f-]{36}$/), expect.any(Uint8Array));
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.anything(), "app-1", "reglas", { system: true });
    const { p_extraction_status: status, p_extraction_method: method } = lastArgs("submit_online_application")!;
    expect([status, method]).toEqual(["sin_texto", "pdf_text"]);
  });

  it("si el OCR falla, la evaluación sigue como siempre", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.scanned = true;
    mocks.ocr.mockRejectedValue(new Error("falla"));
    expect((await submitOnlineApplication(form())).ok).toBe(true);
    await mocks.after[0]!();
    expect(mocks.evaluate).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("un PDF con texto no pasa por OCR", async () => {
    expect((await submitOnlineApplication(form())).ok).toBe(true);
    await mocks.after[0]!();
    expect(mocks.ocr).not.toHaveBeenCalled();
  });

  it("un fallo al evaluar se registra sin datos personales y no afecta la respuesta", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.evaluate.mockRejectedValue(new Error("Ana Pérez Ficticia ana@correo.test"));
    expect((await submitOnlineApplication(form())).ok).toBe(true);
    await mocks.after[0]!();
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain("ana@correo.test");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("Ana");
    spy.mockRestore();
  });

  it("el origen Google sale de document.referrer; sin él, «Página de empleos»", async () => {
    await submitOnlineApplication(form({ referrer: "https://www.google.com.pe/" }));
    expect(lastArgs("submit_online_application")).toMatchObject({ p_portal_name: "Google" });
  });

  it("la IP en claro nunca llega a una RPC: solo su HMAC", async () => {
    await submitOnlineApplication(form());
    const limit = lastArgs("consume_public_rate_limit")!;
    expect(limit).toEqual({
      p_subject: createHmac("sha256", SECRET).update("ip:203.0.113.9").digest("hex"),
      p_vacancy_code: CODE,
    });
    const everything = JSON.stringify(mocks.rpcArgs);
    expect(everything).not.toContain("203.0.113.9");
    expect(everything).not.toContain("10.0.0.1");
    expect(lastArgs("consume_form_challenge")).toEqual({ p_hash: challengeHash(challenge) });
  });

  it("campo trampa relleno: el mismo éxito con una referencia ficticia y sin registrar nada", async () => {
    const result = await submitOnlineApplication(form({ website: "https://spam.test" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reference).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(mocks.calls).toEqual([]);
    expect(mocks.adminCreated).toBe(0);
    // Ni siquiera hace falta un desafío válido.
    const noChallenge = await submitOnlineApplication(form({ website: "x", challenge: "", solution: "" }));
    expect(noChallenge.ok).toBe(true);
    expect(mocks.calls).toEqual([]);
  });

  it("apagado: no hace nada", async () => {
    mocks.enabled = false;
    const result = await submitOnlineApplication(form());
    expect(result.ok).toBe(false);
    expect(mocks.calls).toEqual([]);
    expect((await submitOnlineApplication(form({ website: "x" }))).ok).toBe(false);
  });

  it("un desafío inválido (firma, vacante, reciente, solución) se rechaza antes de tocar la base de datos", async () => {
    const tooFresh = await freshChallenge(CODE, 500);
    const otherVacancy = await freshChallenge("zzzzzzzzzz");
    const cases: Record<string, string | File | null>[] = [
      { challenge: "", solution: "" },
      { solution: "no-es-la-solucion" },
      { challenge: `${challenge}x` },
      { challenge: tooFresh.challenge, solution: tooFresh.solution },
      { challenge: otherVacancy.challenge, solution: otherVacancy.solution },
      { vacancyCode: "no-valido" },
    ];
    for (const overrides of cases) {
      mocks.calls.length = 0;
      const result = await submitOnlineApplication(form(overrides));
      expect(result, JSON.stringify(Object.keys(overrides))).toMatchObject({ ok: false, refreshChallenge: true });
      expect(mocks.calls).toEqual([]);
    }
  });

  it("límite excedido: mensaje propio, sin consumir el desafío ni registrar", async () => {
    mocks.rpcResults.consume_public_rate_limit = { data: false, error: null };
    const result = await submitOnlineApplication(form());
    expect(result).toMatchObject({
      ok: false,
      message: "Demasiados intentos desde esta conexión. Inténtelo más tarde",
    });
    expect(mocks.calls).toEqual(["rpc:consume_form_challenge", "vacancy", "notice", "rpc:consume_public_rate_limit"]);
  });

  it("un desafío ya usado se rechaza sin subir ni registrar", async () => {
    mocks.rpcResults.consume_form_challenge = { data: false, error: null };
    const result = await submitOnlineApplication(form());
    expect(result).toMatchObject({ ok: false, refreshChallenge: true });
    expect(mocks.calls).toEqual(["rpc:consume_form_challenge"]);
  });

  it("detalla los errores de validación sin subir ni registrar", async () => {
    const result = await submitOnlineApplication(
      form({ email: "", acceptNotice: null, cv: new File(["no es un pdf"], "cv.pdf", { type: "application/pdf" }) }),
    );
    expect(result).toMatchObject({ ok: false, refreshChallenge: true });
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["acceptNotice", "cv", "email"]);
      expect(result.fieldErrors?.cv?.[0]).toContain("PDF");
    }
    // Los errores de datos no gastan cupo por conexión.
    expect(mocks.calls).toEqual(["rpc:consume_form_challenge"]);
  });

  it("rechaza un archivo ausente, de otro tipo o con extensión engañosa", async () => {
    const docx = makeDocx(["Texto"]);
    for (const cv of [null, new File([], "cv.pdf", { type: "application/pdf" }), new File(["x"], "cv.exe", { type: "" })]) {
      const { challenge: c, solution: s } = await freshChallenge();
      const result = await submitOnlineApplication(form({ challenge: c, solution: s, cv }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fieldErrors?.cv).toBeDefined();
    }
    const { challenge: c, solution: s } = await freshChallenge();
    const ok = await submitOnlineApplication(
      form({
        challenge: c,
        solution: s,
        cv: new File([docx as BlobPart], "cv.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      }),
    );
    expect(ok.ok).toBe(true);
  });

  it("un posible duplicado recibe la misma respuesta que cualquier otra postulación", async () => {
    mocks.rpcResults.submit_online_application = {
      data: [{ application_id: "app-1", public_reference: "ABCD2345" }],
      error: null,
    };
    const first = await submitOnlineApplication(form());
    const { challenge: c, solution: s } = await freshChallenge();
    mocks.rpcResults.submit_online_application = {
      data: [{ application_id: "app-2", public_reference: "WXYZ6789" }],
      error: null,
    };
    const second = await submitOnlineApplication(form({ challenge: c, solution: s }));
    expect(Object.keys(first)).toEqual(Object.keys(second));
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    // La acción no recibe ni reenvía ninguna señal de duplicado.
    expect(JSON.stringify(first) + JSON.stringify(second)).not.toMatch(/duplic/i);
  });

  it("RH412: pide recargar y borra el archivo si el CV no quedó registrado", async () => {
    mocks.rpcResults.submit_online_application = { data: null, error: { code: "RH412" } };
    const result = await submitOnlineApplication(form());
    expect(result).toEqual({ ok: false, message: "El aviso de privacidad cambió; recargue la página", reload: true });
    expect(mocks.removed).toHaveLength(1);
    expect(mocks.after).toHaveLength(0);
  });

  it("RH409: convocatoria cerrada", async () => {
    mocks.rpcResults.submit_online_application = { data: null, error: { code: "RH409" } };
    const result = await submitOnlineApplication(form());
    expect(result).toEqual({ ok: false, message: "Esta convocatoria ya no recibe postulaciones" });
    expect(mocks.removed).toHaveLength(1);
  });

  it("si la RPC falla pero el CV quedó registrado, no borra el archivo y recupera la referencia", async () => {
    mocks.rpcResults.submit_online_application = { data: null, error: { code: "08006" } };
    mocks.resumeRegistered = true;
    mocks.savedApplication = { id: "app-9", public_reference: "QRST4567" };
    const result = await submitOnlineApplication(form());
    expect(result).toEqual({ ok: true, reference: "QRST4567" });
    expect(mocks.removed).toHaveLength(0);
    await mocks.after[0]!();
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.anything(), "app-9", "reglas", { system: true });
  });

  it("si la RPC falla con otro error y el CV no quedó registrado, borra el archivo y responde genérico", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpcResults.submit_online_application = { data: null, error: { code: "XX000" } };
    const result = await submitOnlineApplication(form());
    expect(result).toMatchObject({ ok: false, message: "No se pudo registrar su postulación. Inténtelo nuevamente." });
    expect(mocks.removed).toHaveLength(1);
    spy.mockRestore();
  });
  it("vacante cerrada o inexistente: se rechaza sin gastar cupo, subir ni registrar", async () => {
    for (const vacancy of [{ acceptingApplications: false }, null]) {
      mocks.vacancy = vacancy;
      mocks.calls.length = 0;
      const { challenge: c, solution: s } = await freshChallenge();
      const result = await submitOnlineApplication(form({ challenge: c, solution: s }));
      expect(result).toEqual({ ok: false, message: "Esta convocatoria ya no recibe postulaciones" });
      expect(mocks.calls).toEqual(["rpc:consume_form_challenge", "vacancy"]);
    }
  });

  it("aviso que no es el vigente: pide recargar sin gastar cupo", async () => {
    for (const noticeId of ["9b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a99", null]) {
      mocks.noticeId = noticeId;
      mocks.calls.length = 0;
      const { challenge: c, solution: s } = await freshChallenge();
      const result = await submitOnlineApplication(form({ challenge: c, solution: s }));
      expect(result).toEqual({ ok: false, message: "El aviso de privacidad cambió; recargue la página", reload: true });
      expect(mocks.calls).toEqual(["rpc:consume_form_challenge", "vacancy", "notice"]);
    }
  });

  it("si la consulta de la vacante lanza, responde genérico sin gastar cupo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.vacancy = new Proxy({}, { get: () => { throw new Error("falla"); } }) as never;
    const result = await submitOnlineApplication(form());
    expect(result).toMatchObject({ ok: false, message: "No se pudo registrar su postulación. Inténtelo nuevamente." });
    expect(mocks.calls).not.toContain("rpc:consume_public_rate_limit");
    spy.mockRestore();
  });

  it("una validación profunda fallida (tras el límite) devuelve el error del CV", async () => {
    const pdfWithScript = new File(["%PDF-1.4\n/JavaScript (alert(1))\n%%EOF"], "cv.pdf", { type: "application/pdf" });
    const result = await submitOnlineApplication(form({ cv: pdfWithScript }));
    expect(result).toMatchObject({ ok: false, message: "Revise los datos ingresados." });
    if (!result.ok) expect(result.fieldErrors?.cv?.[0]).toContain("contenido activo");
    expect(mocks.calls).toEqual(["rpc:consume_form_challenge", "vacancy", "notice", "rpc:consume_public_rate_limit"]);
  });

  it("si la RPC lanza una excepción y el CV quedó registrado, no borra el archivo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpcThrows = true;
    mocks.resumeRegistered = true;
    mocks.savedApplication = { id: "app-7", public_reference: "MNPQ2345" };
    expect(await submitOnlineApplication(form())).toEqual({ ok: true, reference: "MNPQ2345" });
    expect(mocks.removed).toHaveLength(0);
    spy.mockRestore();
  });

  it("si la RPC lanza una excepción y el CV no quedó registrado, borra el archivo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpcThrows = true;
    const result = await submitOnlineApplication(form());
    expect(result).toMatchObject({ ok: false });
    expect(mocks.removed).toHaveLength(1);
    spy.mockRestore();
  });

});
