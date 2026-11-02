import { describe, expect, it, vi } from "vitest";
import { ApiError, BotApi } from "../../bot/src/api";
import { loadConfig } from "../../bot/src/config";

const SECRET = "secreto-ficticio-de-pruebas-0123456789abcdef";

function client(respond: (url: string, init: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => respond(String(url), init ?? {}));
  return { api: new BotApi("https://app.test", SECRET, fetchImpl as unknown as typeof fetch), fetchImpl };
}

const ok = (body: unknown, status = 200) => Response.json(body, { status });

describe("cliente de la API del robot", () => {
  it("envía el Bearer y pide el siguiente trabajo del portal", async () => {
    const { api, fetchImpl } = client(() => ok({ job: null }));
    expect(await api.claim("trabajos-diarios")).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://app.test/api/bot/publicaciones/siguiente");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init!.body as string)).toEqual({ portal: "trabajos-diarios" });
  });

  it("informa el resultado y marca como sincronizada en las rutas esperadas", async () => {
    const { api, fetchImpl } = client(() => ok({ status: "ok" }));
    await api.report("p-1", { outcome: "error", errorCode: "pagina_cambio" });
    await api.markSynced("p-1");
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://app.test/api/bot/publicaciones/p-1/resultado",
      "https://app.test/api/bot/publicaciones/p-1/sincronizada",
    ]);
  });

  it("informa el estado del robot", async () => {
    const { api, fetchImpl } = client(() => ok({ status: "ok" }));
    await api.reportStatus("trabajos-diarios", "necesita_persona", "verificacion_requerida");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://app.test/api/bot/estado");
    expect(JSON.parse(init!.body as string)).toEqual({
      portal: "trabajos-diarios",
      state: "necesita_persona",
      reason: "verificacion_requerida",
    });
  });

  it("lanza ApiError ante una respuesta que no es 2xx", async () => {
    const { api } = client(() => ok({ error: "no_encontrado" }, 404));
    await expect(api.claim("trabajos-diarios")).rejects.toBeInstanceOf(ApiError);
  });

  it("entrega el postulante como multipart con el CV como archivo", async () => {
    const { api, fetchImpl } = client(() => ok({ status: "registrada", applicationId: "a" }));
    const status = await api.sendApplicant(
      "p-1",
      { externalId: "c-1", fullName: "Lucía Ramos Ficticia", email: "lucia@correo.test", resumeRef: "x" },
      { filename: "cv.pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
    );
    expect(status).toBe("registrada");
    const form = fetchImpl.mock.calls[0]![1]!.body as FormData;
    expect(form.get("publicationId")).toBe("p-1");
    expect(form.get("externalId")).toBe("c-1");
    expect(form.get("email")).toBe("lucia@correo.test");
    expect(form.has("phone")).toBe(false);
    expect((form.get("resume") as File).name).toBe("cv.pdf");
  });

  it("traduce las respuestas de la app al estado del postulante", async () => {
    const status = async (code: number, body: unknown = {}) =>
      client(() => ok(body, code)).api.sendApplicant("p", { externalId: "c", fullName: "Nombre", resumeRef: "" }, { filename: "a.pdf", bytes: new Uint8Array() });
    expect(await status(200, { status: "ya_registrada" })).toBe("ya_registrada");
    expect(await status(409)).toBe("cerrada");
    expect(await status(422)).toBe("invalida");
    await expect(status(500)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("configuración", () => {
  const base = { BOT_API_URL: "https://app.test/", PORTAL_BOT_SECRET: SECRET, BOT_ADAPTER: "fake" };

  it("lee los valores y usa un navegador visible por defecto", () => {
    const config = loadConfig(base);
    expect(config.apiUrl).toBe("https://app.test");
    expect(config.headless).toBe(false);
    expect(config.pollSeconds).toBe(600);
  });

  it("rechaza http fuera de localhost, secretos cortos e intervalos demasiado cortos", () => {
    expect(() => loadConfig({ ...base, BOT_API_URL: "http://app.test" })).toThrow(/https/);
    expect(loadConfig({ ...base, BOT_API_URL: "http://localhost:3000" }).apiUrl).toBe("http://localhost:3000");
    expect(() => loadConfig({ ...base, PORTAL_BOT_SECRET: "corto" })).toThrow(/32/);
    expect(() => loadConfig({ ...base, BOT_POLL_SECONDS: "5" })).toThrow(/BOT_POLL_SECONDS/);
    expect(() => loadConfig({ ...base, BOT_API_URL: "" })).toThrow(/BOT_API_URL/);
  });
});
