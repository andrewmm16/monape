import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { mapTalentApplyError, TalentApplyError } from "@/modules/integrations/talent-apply/errors";
import { decodeResumeData, sniffResumeKind, validateIncomingResume } from "@/modules/integrations/talent-apply/resume";
import { MAX_BODY_BYTES, talentApplyPayloadSchema } from "@/modules/integrations/talent-apply/schema";
import {
  isValidApplyToken,
  isValidFeedToken,
  safeEqual,
  talentApplyPostPath,
  talentApplyToken,
} from "@/modules/integrations/talent-apply/token";
import { buildFeedXml } from "@/modules/public-jobs/feed";
import type { PublicSiteContext, PublicVacancy } from "@/modules/public-jobs/types";
import { makeDocx, makePdf } from "../fixtures/documents";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getPublicVacancy: vi.fn(), enabled: true }));

vi.mock("@/modules/integrations/talent-apply/config", () => ({
  getTalentApplyConfig: () =>
    mocks.enabled
      ? { enabled: true, secret: "secreto-ficticio-de-pruebas-0123456789abcdef", feedToken: "x", site: { siteUrl: "https://s.test", companyName: "E" } }
      : { enabled: false },
}));
vi.mock("@/modules/public-jobs/queries", () => ({ getPublicVacancy: (code: string) => mocks.getPublicVacancy(code) }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: () => {
      throw new Error("no debería consultarse");
    },
    storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
  }),
}));

const SECRET = "secreto-ficticio-de-pruebas-0123456789abcdef";
const FEED_TOKEN = "token-feed-ficticio-de-pruebas-0123456789";

function validPayload(data: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "ta-123",
    applicant: {
      fullName: "Ana Pérez Ficticia",
      email: "ana@correo.test",
      phoneNumber: "+51 999 111 222",
      resume: { file: { fileName: "cv.pdf", contentType: "application/pdf", data } },
    },
    job: { jobCompany: "X", jobId: "abc123def4", jobLocation: "Lima", jobTitle: "Analista" },
    analytics: { ip: "203.0.113.9", useragent: "Mozilla/5.0", device: "desktop" },
    questions: [{ question: "¿Años?", answer: "5" }],
    ...overrides,
  };
}

describe("esquema de la carga", () => {
  it("acepta la carga completa y descarta analytics, questions y job", () => {
    const parsed = talentApplyPayloadSchema.parse(validPayload("QUJD"));
    expect(parsed.id).toBe("ta-123");
    expect(parsed.applicant.fullName).toBe("Ana Pérez Ficticia");
    expect(JSON.stringify(parsed)).not.toMatch(/203\.0\.113\.9|Mozilla|jobCompany|Años/);
    expect(Object.keys(parsed).sort()).toEqual(["applicant", "id"]);
  });

  it("el teléfono es opcional; el id numérico se convierte en texto", () => {
    const payload = validPayload("QUJD", { id: 42 });
    delete (payload.applicant as Record<string, unknown>).phoneNumber;
    const parsed = talentApplyPayloadSchema.parse(payload);
    expect(parsed.id).toBe("42");
    expect(parsed.applicant.phoneNumber).toBeUndefined();
  });

  it("acepta el teléfono como número y lo convierte en texto", () => {
    const payload = validPayload("QUJD");
    (payload.applicant as Record<string, unknown>).phoneNumber = 51999111222;
    expect(talentApplyPayloadSchema.parse(payload).applicant.phoneNumber).toBe("51999111222");
  });

  it.each([
    ["sin id", validPayload("QUJD", { id: undefined })],
    ["id vacío", validPayload("QUJD", { id: "  " })],
    ["id de más de 200 caracteres", validPayload("QUJD", { id: "x".repeat(201) })],
    ["sin applicant", validPayload("QUJD", { applicant: undefined })],
    ["sin nombre", validPayload("QUJD", { applicant: { ...validPayload("QUJD").applicant, fullName: "" } })],
    ["correo inválido", validPayload("QUJD", { applicant: { ...validPayload("QUJD").applicant, email: "no-es-correo" } })],
    ["sin correo", validPayload("QUJD", { applicant: { ...validPayload("QUJD").applicant, email: undefined } })],
    ["sin resume.file", validPayload("QUJD", { applicant: { ...validPayload("QUJD").applicant, resume: {} } })],
    ["sin data", validPayload("")],
  ])("rechaza: %s", (_name, payload) => {
    expect(talentApplyPayloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe("CV recibido", () => {
  it("decodifica base64 normal y con prefijo data:", () => {
    const plain = Buffer.from("hola mundo").toString("base64");
    for (const input of [plain, `data:application/pdf;base64,${plain}`, `DATA:;BASE64,${plain}`, `${plain.slice(0, 4)}\r\n${plain.slice(4)}`]) {
      const decoded = decodeResumeData(input);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(Buffer.from(decoded.bytes).toString()).toBe("hola mundo");
    }
  });

  it("rechaza base64 inválido, vacío o demasiado grande", () => {
    expect(decodeResumeData("esto no es base64 !!")).toEqual({ ok: false, reason: "cv_base64_invalido" });
    expect(decodeResumeData("QUJDR")).toEqual({ ok: false, reason: "cv_base64_invalido" });
    expect(decodeResumeData("QU=JD")).toEqual({ ok: false, reason: "cv_base64_invalido" });
    expect(decodeResumeData("data:application/pdf;base64,")).toEqual({ ok: false, reason: "cv_vacio" });
    const big = Buffer.alloc(4 * 1024 * 1024 + 1, 1).toString("base64");
    expect(decodeResumeData(big)).toEqual({ ok: false, reason: "cv_demasiado_grande" });
    const limit = Buffer.alloc(4 * 1024 * 1024, 1).toString("base64");
    expect(decodeResumeData(limit).ok).toBe(true);
  });

  it("valida PDF y DOCX por contenido, no por contentType ni por nombre", async () => {
    const pdf = Buffer.from(await makePdf(["Ana Pérez", "Experiencia con SQL"])).toString("base64");
    const docx = Buffer.from(makeDocx(["Ana Pérez", "Experiencia con SQL"])).toString("base64");

    const okPdf = validateIncomingResume({ fileName: "mi cv.docx", data: `data:text/plain;base64,${pdf}` });
    expect(okPdf).toMatchObject({ ok: true, kind: "pdf", mimeType: "application/pdf", filename: "mi cv.docx.pdf" });
    const okDocx = validateIncomingResume({ fileName: "cv.docx", data: docx });
    expect(okDocx).toMatchObject({ ok: true, kind: "docx", filename: "cv.docx" });
    expect(validateIncomingResume({ data: pdf })).toMatchObject({ ok: true, filename: "cv.pdf" });
  });

  it("rechaza lo que no es PDF/DOCX válido, aunque declare serlo", async () => {
    const text = Buffer.from("texto plano que dice ser un PDF").toString("base64");
    expect(validateIncomingResume({ fileName: "cv.pdf", data: text })).toEqual({ ok: false, reason: "cv_invalido" });
    expect(sniffResumeKind(new TextEncoder().encode("hola"))).toBeNull();

    const withMacro = Buffer.from(makeDocx(["Texto"], { macro: true })).toString("base64");
    expect(validateIncomingResume({ fileName: "cv.docx", data: withMacro })).toEqual({ ok: false, reason: "cv_invalido" });

    const truncatedPdf = Buffer.from("%PDF-1.7\nsin cierre").toString("base64");
    expect(validateIncomingResume({ data: truncatedPdf })).toEqual({ ok: false, reason: "cv_invalido" });
  });
});

describe("token por vacante", () => {
  it("es HMAC-SHA256 de «talent-apply:<código>» en base64url, 32 caracteres", () => {
    const expected = createHmac("sha256", SECRET).update("talent-apply:abc123def4").digest("base64url").slice(0, 32);
    const token = talentApplyToken(SECRET, "abc123def4");
    expect(token).toBe(expected);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("cambia con la vacante y con el secreto", () => {
    expect(talentApplyToken(SECRET, "abc123def4")).not.toBe(talentApplyToken(SECRET, "abc123def5"));
    expect(talentApplyToken(SECRET, "abc123def4")).not.toBe(talentApplyToken(`${SECRET}x`, "abc123def4"));
  });

  it("compara sin importar la longitud y rechaza lo incorrecto", () => {
    const token = talentApplyToken(SECRET, "abc123def4");
    expect(isValidApplyToken(SECRET, "abc123def4", token)).toBe(true);
    expect(isValidApplyToken(SECRET, "abc123def4", token.slice(0, 31))).toBe(false);
    expect(isValidApplyToken(SECRET, "abc123def4", `${token}x`)).toBe(false);
    expect(isValidApplyToken(SECRET, "abc123def4", "")).toBe(false);
    expect(isValidApplyToken(SECRET, "otrocodigo1", token)).toBe(false);
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(isValidFeedToken(FEED_TOKEN, FEED_TOKEN)).toBe(true);
    expect(isValidFeedToken(FEED_TOKEN, `${FEED_TOKEN}x`)).toBe(false);
  });
});

describe("feed con <talent-apply-data>", () => {
  const site: PublicSiteContext = { siteUrl: "https://empleos.ejemplo.test", companyName: "Empresa Ficticia SAC" };
  const vacancy: PublicVacancy = {
    code: "abc123def4",
    title: "Analista de Datos",
    department: "Tecnología",
    description: "Análisis de información comercial y reportes para la toma de decisiones del área.",
    responsibilities: "",
    city: "Lima",
    region: "Lima",
    modality: "hibrido",
    employmentType: "tiempo_completo",
    contractType: null,
    salary: null,
    firstPublishedAt: "2026-10-28T15:00:00+00:00",
    closingDate: null,
    updatedAt: "2026-10-28T15:00:00+00:00",
  };
  const now = new Date("2026-10-29T12:00:00Z");

  it("sin la opción, el feed no cambia", () => {
    expect(buildFeedXml([vacancy], site, now)).not.toContain("talent-apply-data");
  });

  it("cada job lleva su talent-apply-posturl codificado y con el token de su vacante", () => {
    const xml = buildFeedXml([vacancy], site, now, {
      talentApplyPostUrl: (v) => `${site.siteUrl}${talentApplyPostPath(v.code, talentApplyToken(SECRET, v.code))}`,
    });
    const postUrl = `https://empleos.ejemplo.test/api/integraciones/talent/postular/abc123def4/${talentApplyToken(SECRET, "abc123def4")}`;
    expect(xml).toContain(`<talent-apply-data><![CDATA[talent-apply-posturl=${encodeURIComponent(postUrl)}]]></talent-apply-data>`);
    expect(xml).toContain("https%3A%2F%2Fempleos.ejemplo.test%2Fapi%2Fintegraciones%2Ftalent%2Fpostular%2Fabc123def4%2F");
    // Sin la URL en claro dentro del bloque de datos.
    expect(xml.match(/<talent-apply-data>[\s\S]*?<\/talent-apply-data>/)![0]).not.toContain("https://");
    expect(xml.match(/<talent-apply-data>/g)).toHaveLength(1);
    expect(xml.indexOf("<talent-apply-data>")).toBeGreaterThan(xml.indexOf("<job>"));
    expect(xml.indexOf("<talent-apply-data>")).toBeLessThan(xml.indexOf("</job>"));
  });
});

describe("mapeo de errores a códigos HTTP", () => {
  it("errores propios, de la aplicación y de PostgREST", () => {
    expect(mapTalentApplyError(new TalentApplyError(413, "cuerpo_demasiado_grande"))).toBe(413);
    expect(mapTalentApplyError(new TalentApplyError(415, "tipo_no_admitido"))).toBe(415);
    expect(mapTalentApplyError(new AppError("x", "rate_limited"))).toBe(429);
    expect(mapTalentApplyError(new AppError("x", "validation"))).toBe(422);
    expect(mapTalentApplyError(new AppError("x", "not_found"))).toBe(404);
    // Solo RH409 (vacante cerrada o vencida) es 410; otro conflicto es un error interno.
    expect(mapTalentApplyError(new AppError("x", "conflict"))).toBe(500);
    expect(mapTalentApplyError({ code: "23505", message: "duplicate key" })).toBe(500);
    expect(mapTalentApplyError({ code: "23503", message: "foreign key" })).toBe(500);
    expect(mapTalentApplyError(new AppError("x", "unavailable"))).toBe(500);
    expect(mapTalentApplyError({ code: "RH404", message: "La vacante no existe" })).toBe(404);
    expect(mapTalentApplyError({ code: "RH409", message: "La vacante ya no recibe postulaciones" })).toBe(410);
    expect(mapTalentApplyError({ code: "RH422", message: "x" })).toBe(422);
    expect(mapTalentApplyError({ code: "23514" })).toBe(422);
    expect(mapTalentApplyError({ code: "42501" })).toBe(500);
    expect(mapTalentApplyError(new Error("inesperado"))).toBe(500);
    expect(mapTalentApplyError(undefined)).toBe(500);
  });
});

describe("receiveTalentApply (con dependencias simuladas)", () => {
  const CODE = "abc123def4";

  beforeEach(() => {
    mocks.enabled = true;
    mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
    mocks.getPublicVacancy.mockReset().mockResolvedValue({ code: CODE, acceptingApplications: true });
  });

  async function post(body: BodyInit | null, init: { token?: string; headers?: Record<string, string> } = {}) {
    const { receiveTalentApply } = await import("@/modules/integrations/talent-apply/receive");
    const request = new Request("https://s.test/api", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...init.headers },
    });
    return receiveTalentApply(request, CODE, init.token ?? talentApplyToken(SECRET, CODE));
  }

  it("apagada, token incorrecto o vacante inexistente: 404 sin detalle", async () => {
    mocks.enabled = false;
    const off = await post("{}");
    expect(off.status).toBe(404);
    expect(await off.text()).toBe("");
    mocks.enabled = true;
    expect((await post("{}", { token: "incorrecto" })).status).toBe(404);
    mocks.getPublicVacancy.mockResolvedValue(null);
    expect((await post("{}")).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("exige JSON (415) y corta por content-length (413) antes de leer", async () => {
    expect((await post("{}", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const tooBig = await post("{}", { headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
    expect(tooBig.status).toBe(413);
    expect(mocks.getPublicVacancy).not.toHaveBeenCalled();
  });

  it("corta el cuerpo mientras se lee aunque el encabezado falte (413)", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 8) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const { receiveTalentApply } = await import("@/modules/integrations/talent-apply/receive");
    const request = new Request("https://s.test/api", {
      method: "POST",
      body: stream,
      headers: { "content-type": "application/json" },
      // @ts-expect-error `duplex` es obligatorio para cuerpos en streaming en Node.
      duplex: "half",
    });
    const response = await receiveTalentApply(request, CODE, talentApplyToken(SECRET, CODE));
    expect(response.status).toBe(413);
  });

  it("JSON mal formado: 400; carga inválida: 422; límite superado: 429; todo sin repetir la entrada", async () => {
    const malformed = await post('{"id": "secreto-no-repetir"');
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain("secreto-no-repetir");

    const invalid = await post(JSON.stringify({ id: "x", applicant: { fullName: "Ana Ficticia", email: "malo" } }));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ status: "error", code: "carga_invalida" });

    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const limited = await post("{}");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
  });
});
