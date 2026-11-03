import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, loadRepairConfig } from "../../bot/src/config";
import { askModel, createCompleteFromConfig, createOpenAICompatComplete, extractJsonText } from "../../bot/src/repair/client";

const env = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };

const RESPUESTA = { sin_propuesta: false, clave: "publicar.boton", selector: "button#nuevo", confianza: "media", razon: "El botón cambió de id." };

describe("configuración del proveedor openai (servidor propio, p. ej. Qwen)", () => {
  it("por defecto sigue siendo Anthropic y nada cambia", () => {
    expect(loadRepairConfig({})).toMatchObject({ repairEnabled: false, repairProvider: "anthropic", repairBaseUrl: null, repairModel: "claude-sonnet-5-5" });
    expect(loadRepairConfig({ ANTHROPIC_API_KEY: "k" })).toMatchObject({ repairEnabled: true, repairProvider: "anthropic" });
  });

  it("con openai se activa con la dirección y el modelo, sin clave", () => {
    const config = loadRepairConfig({ BOT_REPAIR_PROVIDER: "openai", BOT_REPAIR_BASE_URL: "http://qwen.interno:8000/v1/", BOT_REPAIR_MODEL: "Qwen/Qwen3-32B" });
    expect(config).toMatchObject({
      repairEnabled: true,
      repairProvider: "openai",
      repairBaseUrl: "http://qwen.interno:8000/v1",
      repairModel: "Qwen/Qwen3-32B",
      repairJsonMode: "prompt",
      repairTimeoutSeconds: 120,
    });
  });

  it("admite el nombre de modelo estilo Ollama y los dos modos de JSON", () => {
    const base = { BOT_REPAIR_PROVIDER: "openai", BOT_REPAIR_BASE_URL: "https://q.example/v1", BOT_REPAIR_MODEL: "qwen3:32b" };
    expect(loadRepairConfig({ ...base, BOT_REPAIR_JSON_MODE: "schema", BOT_REPAIR_TIMEOUT_SECONDS: "300" })).toMatchObject({ repairModel: "qwen3:32b", repairJsonMode: "schema", repairTimeoutSeconds: 300 });
  });

  it("la ANTHROPIC_API_KEY no activa el servidor propio ni al revés", () => {
    expect(loadRepairConfig({ ANTHROPIC_API_KEY: "k", BOT_REPAIR_PROVIDER: "openai", BOT_REPAIR_BASE_URL: "http://a/v1", BOT_REPAIR_MODEL: "m1" }).repairProvider).toBe("openai");
    expect(loadRepairConfig({ BOT_REPAIR_BASE_URL: "http://a/v1" }).repairEnabled).toBe(false); // sigue en anthropic, sin clave
  });

  it("rechaza configuraciones incompletas o peligrosas", () => {
    const ok = { BOT_REPAIR_PROVIDER: "openai", BOT_REPAIR_BASE_URL: "http://a/v1", BOT_REPAIR_MODEL: "m1" };
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_MODEL: "" })).toThrow(/BOT_REPAIR_MODEL es obligatorio/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_BASE_URL: "" })).toThrow(/BOT_REPAIR_BASE_URL es obligatorio/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_BASE_URL: "no es una url" })).toThrow(/BOT_REPAIR_BASE_URL/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_BASE_URL: "ftp://a/v1" })).toThrow(/http/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_BASE_URL: "http://usuario:clave@a/v1" })).toThrow(/API_KEY/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_PROVIDER: "gemini" })).toThrow(/BOT_REPAIR_PROVIDER/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_JSON_MODE: "raro" })).toThrow(/BOT_REPAIR_JSON_MODE/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_TIMEOUT_SECONDS: "1" })).toThrow(/BOT_REPAIR_TIMEOUT_SECONDS/);
    expect(() => loadRepairConfig({ ...ok, BOT_REPAIR_MODEL: "mo delo;rm" })).toThrow(/BOT_REPAIR_MODEL/);
  });

  it("llega a loadConfig y el tope diario 0 lo apaga", () => {
    const ok = { ...env, BOT_REPAIR_PROVIDER: "openai", BOT_REPAIR_BASE_URL: "http://a/v1", BOT_REPAIR_MODEL: "m1" };
    expect(loadConfig(ok).repairEnabled).toBe(true);
    expect(loadConfig({ ...ok, BOT_REPAIR_MAX_PER_DAY: "0" }).repairEnabled).toBe(false);
  });
});

describe("extractJsonText", () => {
  const json = JSON.stringify(RESPUESTA);
  it("deja el JSON limpio tal cual", () => expect(extractJsonText(json)).toBe(json));
  it("quita el razonamiento <think> de Qwen3", () => expect(extractJsonText(`<think>\nvoy a mirar el botón {raro}\n</think>\n${json}`)).toBe(json));
  it("quita la valla de código", () => {
    expect(extractJsonText("```json\n" + json + "\n```")).toBe(json);
    expect(extractJsonText("```\n" + json + "\n```")).toBe(json);
  });
  it("saca el JSON de entre texto", () => expect(extractJsonText(`Claro, aquí está: ${json}. Espero que sirva.`)).toBe(json));
  it("si no hay JSON devuelve el texto (askModel lo rechazará)", () => expect(extractJsonText("no sé")).toBe("no sé"));
});

describe("cliente compatible con OpenAI contra un servidor local", () => {
  interface Seen {
    method?: string;
    url?: string;
    auth?: string;
    body?: Record<string, unknown>;
  }
  let server: http.Server;
  let base = "";
  let seen: Seen[] = [];
  /** Respuestas sucesivas del servidor falso: [estado, cuerpo, retraso opcional]. */
  let script: [number, unknown, number?][] = [];

  beforeEach(async () => {
    seen = [];
    script = [];
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
        const [status, payload, delay] = script.shift() ?? [500, { error: "sin guion" }];
        setTimeout(() => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
        }, delay ?? 0);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const chat = (content: unknown, finish = "stop") => ({ choices: [{ message: { role: "assistant", content }, finish_reason: finish }], usage: { prompt_tokens: 120, completion_tokens: 35 } });
  const request = { model: "Qwen/Qwen3-32B", system: "Eres un asistente.", prompt: "Esquema: …" };

  it("envía la consulta con el formato OpenAI y entiende una respuesta con razonamiento y valla", async () => {
    script = [[200, chat("<think>pienso</think>\n```json\n" + JSON.stringify(RESPUESTA) + "\n```")]];
    const complete = createOpenAICompatComplete({ baseUrl: base, apiKey: "clave-interna", jsonMode: "prompt", timeoutMs: 5_000 });
    const answer = await askModel(complete, request);

    expect(answer).toMatchObject({ ok: true, respuesta: RESPUESTA, tokensEntrada: 120, tokensSalida: 35 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/chat/completions", auth: "Bearer clave-interna" });
    const body = seen[0].body as { model: string; temperature: number; max_tokens: number; messages: { role: string; content: string }[]; response_format?: unknown };
    expect(body.model).toBe("Qwen/Qwen3-32B");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(4_000);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[0].content).toContain("Eres un asistente.");
    expect(body.messages[0].content).toContain("sin_propuesta"); // le explica el JSON en el texto
    expect(body.messages[1].content).toBe("Esquema: …");
    expect(body.response_format).toBeUndefined();
  });

  it("en modo schema pide response_format json_schema; sin clave no envía Authorization", async () => {
    script = [[200, chat(JSON.stringify(RESPUESTA))]];
    const complete = createOpenAICompatComplete({ baseUrl: `${base}/`, jsonMode: "schema", timeoutMs: 5_000 });
    expect((await askModel(complete, request)).ok).toBe(true);
    expect(seen[0].auth).toBeUndefined();
    expect(seen[0].url).toBe("/v1/chat/completions");
    expect(seen[0].body?.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "propuesta_selector", strict: true } });
  });

  it("acepta el contenido como lista de partes de texto", async () => {
    script = [[200, chat([{ type: "text", text: JSON.stringify(RESPUESTA) }])]];
    const complete = createOpenAICompatComplete({ baseUrl: base, jsonMode: "prompt", timeoutMs: 5_000 });
    expect((await askModel(complete, request)).ok).toBe(true);
  });

  it("traduce finish_reason: length → corte, content_filter → rechazo", async () => {
    const complete = createOpenAICompatComplete({ baseUrl: base, jsonMode: "prompt", timeoutMs: 5_000 });
    script = [[200, chat('{"sin_prop', "length")]];
    expect(await askModel(complete, request)).toMatchObject({ ok: false, motivo: expect.stringContaining("max_tokens") });
    script = [[200, chat("", "content_filter")]];
    expect(await askModel(complete, request)).toMatchObject({ ok: false, motivo: expect.stringContaining("refusal") });
  });

  it("una respuesta que no es JSON no da propuesta", async () => {
    script = [[200, chat("No puedo ayudar con eso.")]];
    const complete = createOpenAICompatComplete({ baseUrl: base, jsonMode: "prompt", timeoutMs: 5_000 });
    expect(await askModel(complete, request)).toMatchObject({ ok: false, motivo: "la respuesta del modelo no es JSON" });
  });

  it("reintenta una vez ante un 503 y sigue", async () => {
    script = [
      [503, { error: "ocupado" }],
      [200, chat(JSON.stringify(RESPUESTA))],
    ];
    const complete = createOpenAICompatComplete({ baseUrl: base, jsonMode: "prompt", timeoutMs: 5_000 });
    expect((await askModel(complete, request)).ok).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it("si el servidor sigue fallando, el error dice el estado y no filtra la clave", async () => {
    script = [
      [500, "fallo interno"],
      [500, "fallo interno"],
    ];
    const complete = createOpenAICompatComplete({ baseUrl: base, apiKey: "secreto-123", jsonMode: "prompt", timeoutMs: 5_000 });
    const error = await complete(request).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toMatch(/respondió 500/);
    expect(error?.message).not.toContain("secreto-123");
  });

  it("un 400 (p. ej. el servidor no admite response_format) no se reintenta y explica el motivo", async () => {
    script = [[400, { error: { message: "response_format not supported" } }]];
    const complete = createOpenAICompatComplete({ baseUrl: base, jsonMode: "schema", timeoutMs: 5_000 });
    await expect(complete(request)).rejects.toThrow(/respondió 400.*response_format/);
    expect(seen).toHaveLength(1);
  });

  it("avisa si el servidor tarda más del tiempo permitido", async () => {
    script = [[200, chat(JSON.stringify(RESPUESTA)), 600]];
    const complete = createOpenAICompatComplete({ baseUrl: base, jsonMode: "prompt", timeoutMs: 100 });
    await expect(complete(request)).rejects.toThrow(/no respondió/);
  });

  it("avisa si no hay nadie escuchando", async () => {
    const complete = createOpenAICompatComplete({ baseUrl: "http://127.0.0.1:9/v1", jsonMode: "prompt", timeoutMs: 2_000 });
    await expect(complete(request)).rejects.toThrow(/no se pudo conectar/);
  });

  it("createCompleteFromConfig toma la clave del entorno (BOT_REPAIR_API_KEY) y la dirección de la configuración", async () => {
    script = [[200, chat(JSON.stringify(RESPUESTA))]];
    const config = loadRepairConfig({ BOT_REPAIR_PROVIDER: "openai", BOT_REPAIR_BASE_URL: base, BOT_REPAIR_MODEL: "Qwen/Qwen3-32B" });
    const complete = createCompleteFromConfig(config, { BOT_REPAIR_API_KEY: "  token-del-entorno  " });
    expect((await askModel(complete, request)).ok).toBe(true);
    expect(seen[0].auth).toBe("Bearer token-del-entorno");
  });
});
