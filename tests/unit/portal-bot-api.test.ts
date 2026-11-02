import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makePdf } from "../fixtures/documents";

const SECRET = "secreto-ficticio-de-pruebas-0123456789abcdef";
const PUBLICATION = "0b1f6a52-3c1e-4c53-9d6e-2f1f3a7a9c11";

const mocks = vi.hoisted(() => ({
  secret: undefined as string | undefined,
  rpc: vi.fn(),
  evaluate: vi.fn(),
  /** Fila previa de integration_submissions (null = nunca se registró). */
  prior: null as { application_id: string } | null,
  /** Error de la tabla de portales (simula una caída de la base de datos). */
  portalError: null as { code: string } | null,
}));

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ PORTAL_BOT_SECRET: mocks.secret }) }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/modules/evaluation/service", () => ({ evaluateApplication: (...a: unknown[]) => mocks.evaluate(...a) }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      // El portal existe; el CV nunca quedó registrado (para el caso de error de la función).
      chain.maybeSingle = async () => ({
        data: table === "job_portals" ? { id: "portal-1" } : table === "integration_submissions" ? mocks.prior : null,
        error: table === "job_portals" ? mocks.portalError : null,
      });
      return chain;
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
  }),
}));

vi.mock("@/modules/resumes/extraction", () => ({
  extractResume: async () => ({
    status: "completada",
    method: "pdf_text",
    extractorVersion: "extractor-v1",
    text: "Texto ficticio del CV con experiencia en SQL.",
    warnings: [],
    errorCode: null,
    suggestions: {},
  }),
  needsOcr: () => false,
}));
vi.mock("@/modules/resumes/ocr-apply", () => ({ applyOcrToResume: vi.fn() }));

import { receiveBotApplicant } from "@/modules/portal-bot/applicants";
import { reportBotStatus } from "@/modules/portal-bot/status";
import {
  claimNextPublication,
  listActivePublications,
  markPublicationSynced,
  reportPublication,
} from "@/modules/portal-bot/publications";

function req(url: string, init: { method?: string; body?: BodyInit; json?: unknown; token?: string | null } = {}) {
  const token = init.token === undefined ? SECRET : init.token;
  return new Request(`http://localhost${url}`, {
    method: init.method ?? "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.json ? { "content-type": "application/json" } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

beforeEach(() => {
  mocks.secret = SECRET;
  mocks.rpc.mockReset();
  mocks.evaluate.mockReset().mockResolvedValue("eval-1");
  mocks.prior = null;
  mocks.portalError = null;
});

describe("autorización", () => {
  it("responde 404 si está apagada, sin token o con token incorrecto", async () => {
    const calls = (token?: string | null) => [
      claimNextPublication(req("/api/bot/publicaciones/siguiente", { json: { portal: "trabajos-diarios" }, token })),
      listActivePublications(req("/api/bot/publicaciones/activas?portal=trabajos-diarios", { method: "GET", token })),
      reportPublication(req("/x", { json: { outcome: "error", errorCode: "x" }, token }), PUBLICATION),
      markPublicationSynced(req("/x", { token }), PUBLICATION),
      receiveBotApplicant(req("/api/bot/postulantes", { body: new FormData(), token })),
      reportBotStatus(req("/api/bot/estado", { json: { portal: "trabajos-diarios", state: "activo" }, token })),
    ];
    for (const token of [null, "otro"]) {
      for (const response of await Promise.all(calls(token))) expect(response.status).toBe(404);
    }
    mocks.secret = undefined;
    for (const response of await Promise.all(calls(SECRET))) expect(response.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("cola de publicaciones", () => {
  it("devuelve el trabajo reservado o null si no hay", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{ publication_id: PUBLICATION, action: "publicar", external_id: null, vacancy: { title: "Operario" } }],
      error: null,
    });
    const first = await claimNextPublication(req("/p", { json: { portal: "trabajos-diarios" } }));
    expect(await first.json()).toEqual({
      job: { publicationId: PUBLICATION, action: "publicar", externalId: null, vacancy: { title: "Operario" } },
    });
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await (await claimNextPublication(req("/p", { json: { portal: "trabajos-diarios" } }))).json()).toEqual({ job: null });
  });

  it("rechaza portales desconocidos y cuerpos inválidos", async () => {
    expect((await claimNextPublication(req("/p", { json: { portal: "otro-portal" } }))).status).toBe(404);
    expect((await claimNextPublication(req("/p", { json: {} }))).status).toBe(422);
  });

  it("valida el resultado y traduce los conflictos de la base de datos", async () => {
    expect((await reportPublication(req("/r", { json: { outcome: "publicada" } }), PUBLICATION)).status).toBe(422);
    expect((await reportPublication(req("/r", { json: { outcome: "error", errorCode: "Texto libre" } }), PUBLICATION)).status).toBe(422);
    expect((await reportPublication(req("/r", { json: { outcome: "error", errorCode: "x" } }), "no-uuid")).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "RH409" } });
    const conflict = await reportPublication(
      req("/r", { json: { outcome: "publicada", externalId: "e1", externalUrl: "https://portal.test/o/1" } }),
      PUBLICATION,
    );
    expect(conflict.status).toBe(409);
  });
});

describe("estado del robot", () => {
  it("guarda el estado y la causa del portal", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    const response = await reportBotStatus(
      req("/api/bot/estado", { json: { portal: "trabajos-diarios", state: "necesita_persona", reason: "verificacion_requerida" } }),
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("bot_report_status", {
      p_portal_id: "portal-1",
      p_state: "necesita_persona",
      p_reason: "verificacion_requerida",
    });
  });

  it("rechaza estados desconocidos, causas con texto libre y portales inexistentes", async () => {
    const call = (json: unknown) => reportBotStatus(req("/api/bot/estado", { json }));
    expect((await call({ portal: "trabajos-diarios", state: "roto" })).status).toBe(422);
    expect((await call({ portal: "trabajos-diarios", state: "activo", reason: "Texto libre" })).status).toBe(422);
    expect((await call({ portal: "otro-portal", state: "activo" })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("postulantes", () => {
  let pdf: Uint8Array<ArrayBuffer>;
  beforeAll(async () => {
    pdf = new Uint8Array(await makePdf(["Lucía Ramos Ficticia", "Experiencia de cinco años en SQL y análisis de datos."]));
  });

  function form(overrides: Record<string, string | null> = {}, file: File | null | undefined = undefined) {
    const data = new FormData();
    const values: Record<string, string | null> = {
      publicationId: PUBLICATION,
      externalId: "cand-1",
      fullName: "Lucía Ramos Ficticia",
      email: "lucia@correo.test",
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) if (value !== null) data.set(key, value);
    const resume = file === undefined ? new File([pdf], "cv.pdf") : file;
    if (resume) data.set("resume", resume);
    return data;
  }

  it("rechaza campos faltantes y archivos que no son un CV", async () => {
    expect((await receiveBotApplicant(req("/a", { body: form({ fullName: null }) }))).status).toBe(422);
    expect((await receiveBotApplicant(req("/a", { body: form({}, null) }))).status).toBe(422);
    const notCv = await receiveBotApplicant(req("/a", { body: form({}, new File(["no es un cv"], "cv.pdf")) }));
    expect(notCv.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("registra al postulante y lo evalúa con el motor de reglas en modo sistema", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ application_id: "app-1", already_registered: false }], error: null });
    const response = await receiveBotApplicant(req("/a", { body: form() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "registrada", applicationId: "app-1" });
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("register_bot_application");
    expect(args).toMatchObject({ p_publication_id: PUBLICATION, p_external_id: "cand-1", p_email: "lucia@correo.test" });
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.anything(), "app-1", "reglas", { system: true });
  });

  it("una repetición responde ya_registrada y no vuelve a evaluar", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ application_id: "app-1", already_registered: true }], error: null });
    const response = await receiveBotApplicant(req("/a", { body: form() }));
    expect(await response.json()).toEqual({ status: "ya_registrada", applicationId: "app-1" });
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it("un correo inválido o un teléfono demasiado largo no cuestan el postulante: se ignoran esos datos", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ application_id: "app-1", already_registered: false }], error: null });
    const response = await receiveBotApplicant(req("/a", { body: form({ email: "no-es-un-correo", phone: "9".repeat(80) }) }));
    expect(response.status).toBe(200);
    expect(mocks.rpc.mock.calls[0]![1]).toMatchObject({ p_email: null, p_phone: null });
  });

  it("un reenvío ya registrado responde antes de extraer, subir o llamar a la función de registro", async () => {
    mocks.prior = { application_id: "app-previa" };
    const response = await receiveBotApplicant(req("/a", { body: form() }));
    expect(await response.json()).toEqual({ status: "ya_registrada", applicationId: "app-previa" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it("un nombre demasiado corto sigue rechazándose", async () => {
    expect((await receiveBotApplicant(req("/a", { body: form({ fullName: "A" }) }))).status).toBe(422);
  });

  it("una caída de la base de datos al buscar el portal responde 500, no un falso 404", async () => {
    mocks.portalError = { code: "08006" };
    const response = await claimNextPublication(req("/p", { json: { portal: "trabajos-diarios" } }));
    expect(response.status).toBe(500);
  });

  it("una vacante que ya no recibe postulaciones responde 409", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "RH409" } });
    const response = await receiveBotApplicant(req("/a", { body: form() }));
    expect(response.status).toBe(409);
  });
});
