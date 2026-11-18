import { describe, expect, it, vi } from "vitest";
import { AppApiError, type AppApi } from "../../ia-worker/src/api";
import {
  AUTH_PAUSE_MS,
  buildChildEnv,
  buildClaudeArgs,
  CliNotFoundError,
  DEFAULT_LIMIT_PAUSE_MS,
  parseCliOutput,
  runClaude,
  type CliOutcome,
} from "../../ia-worker/src/cli";
import { loadConfig } from "../../ia-worker/src/config";
import type { Job, Report } from "../../ia-worker/src/types";
import { CLI_MISSING_PAUSE_MS, processOnce } from "../../ia-worker/src/worker";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const JOB: Job = {
  id: "7d4c2a10-5b3e-4f6a-9c1d-2e3f4a5b6c7d",
  claimToken: "9e8d7c6b-1234-4abc-8def-0123456789ab",
  attempt: 1,
  model: "claude-opus-5-5",
  effort: "medium",
  system: "Eres un asistente de RRHH.",
  prompt: "Vacante: X\n<cv>\nTexto del CV\n</cv>",
  schema: { type: "object", properties: { items: { type: "array" } } },
};

const envelope = (overrides: Record<string, unknown>) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    api_error_status: null,
    result: "",
    usage: { input_tokens: 2, cache_creation_input_tokens: 1200, cache_read_input_tokens: 0, output_tokens: 400 },
    modelUsage: { "claude-opus-5-5": {} },
    ...overrides,
  });

const out = (stdout: string, extra: Partial<{ code: number; stderr: string; timedOut: boolean }> = {}) => ({
  code: 0,
  stdout,
  stderr: "",
  timedOut: false,
  ...extra,
});

describe("argumentos del CLI", () => {
  it("aísla la llamada: sin herramientas, sin settings ni MCP, sin guardar sesión y con salida estructurada", () => {
    const args = buildClaudeArgs(JOB);
    expect(args[0]).toBe("-p");
    expect(args).toEqual(expect.arrayContaining(["--output-format", "json", "--model", "claude-opus-5-5", "--effort", "medium"]));
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).toEqual(expect.arrayContaining(["--restricted", "--strict-mcp-config", "--no-session-persistence"]));
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1]!)).toEqual(JOB.schema);
    expect(args[args.indexOf("--system-prompt") + 1]).toBe(JOB.system);
    // El CV no va en la línea de comandos (viaja por stdin).
    expect(args.join(" ")).not.toContain("Texto del CV");
    expect(args).not.toContain("--bare"); // --bare ignora el OAuth
  });

  it("el proceso hijo no recibe claves de la API, la configuración del worker ni otros secretos", () => {
    const env = buildChildEnv({
      NODE_ENV: "test",
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_AUTH_TOKEN: "t",
      IA_WORKER_SECRET: "s",
      IA_WORKER_APP_URL: "https://app.test",
      SUPABASE_SECRET_KEY: "sb",
      DB_PASSWORD: "pw",
      GITHUB_TOKEN: "gh",
      CLAUDE_CODE_OAUTH_TOKEN: "oat",
      PATH: "/bin",
      USERPROFILE: "C:\\Users\\x",
    });
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "IA_WORKER_SECRET", "IA_WORKER_APP_URL", "SUPABASE_SECRET_KEY", "DB_PASSWORD", "GITHUB_TOKEN"]) {
      expect(env[name], name).toBeUndefined();
    }
    expect(env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "oat", PATH: "/bin", USERPROFILE: "C:\\Users\\x", DISABLE_AUTOUPDATER: "1" });
  });

  it("envía el prompt por stdin", async () => {
    const run = vi.fn(async () => out(envelope({ structured_output: { items: [] } })));
    await runClaude(JOB, { cliPath: "claude", timeoutMs: 1_000, runImpl: run });
    expect(run).toHaveBeenCalledWith("claude", buildClaudeArgs(JOB), JOB.prompt, 1_000);
  });
});

describe("salida del CLI", () => {
  it("usa structured_output y el modelo real, con el consumo incluido el contexto cacheado", () => {
    const outcome = parseCliOutput(out(envelope({ structured_output: { items: [1] }, result: "{}" })), NOW);
    expect(outcome).toEqual({ kind: "ok", output: { items: [1] }, model: "claude-opus-5-5", usage: { inputTokens: 1202, outputTokens: 400 } });
  });

  it("sin structured_output, lee el JSON del resultado (también dentro de ```json)", () => {
    expect(parseCliOutput(out(envelope({ result: '```json\n{"items":[]}\n```' })), NOW)).toMatchObject({ kind: "ok", output: { items: [] } });
    expect(parseCliOutput(out(envelope({ result: "No puedo ayudar con eso." })), NOW)).toMatchObject({ kind: "error", code: "salida_invalida" });
  });

  it("detecta el límite del plan y usa la hora de renovación si viene en el mensaje", () => {
    const epoch = Math.floor(NOW / 1000) + 3600;
    expect(
      parseCliOutput(out(envelope({ is_error: true, subtype: "error_during_execution", result: `Claude AI usage limit reached|${epoch}` }), { code: 1 }), NOW),
    ).toMatchObject({ kind: "limit", code: "limite_plan", retryAt: epoch * 1000 });
    expect(
      parseCliOutput(out(envelope({ is_error: true, api_error_status: 429, result: "You've hit your limit · resets 5pm" }), { code: 1 }), NOW),
    ).toMatchObject({ kind: "limit", code: "limite_plan", retryAt: NOW + DEFAULT_LIMIT_PAUSE_MS });
  });

  it("una sesión inválida pausa el worker sin gastar intentos", () => {
    expect(parseCliOutput(out("", { code: 1, stderr: "Invalid API key · Please run /login" }), NOW)).toMatchObject({
      kind: "limit",
      code: "sin_sesion",
      retryAt: NOW + AUTH_PAUSE_MS,
    });
    expect(
      parseCliOutput(out(envelope({ is_error: true, api_error_status: 401, result: "OAuth token has expired" }), { code: 1 }), NOW),
    ).toMatchObject({ kind: "limit", code: "sin_sesion" });
  });

  it("tiempo agotado y fallos desconocidos se reintentan", () => {
    expect(parseCliOutput(out("", { timedOut: true }), NOW)).toMatchObject({ kind: "error", code: "cli_timeout", retryable: true });
    expect(parseCliOutput(out("", { code: 1, stderr: "Segmentation fault" }), NOW)).toMatchObject({ kind: "error", code: "cli_error", retryable: true });
  });

  it("un texto genérico de «rate limit» sin estado 429 no se toma por límite del plan (contaría sin fin)", () => {
    expect(
      parseCliOutput(out(envelope({ is_error: true, result: "rate limit of the upstream tool exceeded" }), { code: 1 }), NOW),
    ).toMatchObject({ kind: "error", code: "cli_error" });
  });

  it("el detalle para el log enmascara correos, enlaces y números y no usa stdout sin envoltorio", () => {
    const outcome = parseCliOutput(
      out("contenido arbitrario del modelo", { code: 1, stderr: "fallo con ana@correo.test https://x.test/a 999 111 222" }),
      NOW,
    );
    expect(outcome.kind).toBe("error");
    const detail = outcome.kind === "error" ? outcome.detail : "";
    expect(detail).not.toMatch(/ana@correo|x\.test|999 111 222|contenido arbitrario/);
  });
});

describe("ciclo del worker", () => {
  function fakeApi(job: Job | null) {
    const reports: Report[] = [];
    const api: AppApi = {
      claim: async () => ({ job, paused: false }),
      status: async () => undefined,
      report: async (reportedJob, report) => {
        expect(reportedJob).toMatchObject({ id: JOB.id, claimToken: JOB.claimToken });
        reports.push(report);
      },
    };
    return { api, reports };
  }
  const deps = (api: AppApi, runModel: (job: Job) => Promise<CliOutcome>, extra: Record<string, unknown> = {}) => ({
    api,
    runModel,
    log: () => undefined,
    now: () => NOW,
    sleep: async () => undefined,
    ...extra,
  });

  it("sin trabajos queda en espera", async () => {
    const { api } = fakeApi(null);
    expect(await processOnce(deps(api, vi.fn()))).toEqual({ kind: "idle" });
  });

  it("ejecuta el trabajo con el modelo indicado (o el forzado) e informa la salida", async () => {
    const { api, reports } = fakeApi(JOB);
    const run = vi.fn(async (): Promise<CliOutcome> => ({ kind: "ok", output: { items: [] }, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1 } }));
    expect(await processOnce(deps(api, run, { modelOverride: "claude-sonnet-5-5" }))).toEqual({ kind: "done" });
    expect(run).toHaveBeenCalledWith({ ...JOB, model: "claude-sonnet-5-5" });
    expect(reports).toEqual([{ outcome: "ok", output: { items: [] }, model: "claude-sonnet-5-5" }]);
  });

  it("al llegar al límite informa la espera y pausa el worker hasta la renovación", async () => {
    const { api, reports } = fakeApi(JOB);
    const retryAt = NOW + 3_600_000;
    const step = await processOnce(deps(api, async () => ({ kind: "limit", code: "limite_plan", retryAt, detail: "x" })));
    expect(step).toMatchObject({ kind: "pause", untilMs: retryAt, code: "limite_plan" });
    expect(reports).toEqual([{ outcome: "limite", errorCode: "limite_plan", retryAt: new Date(retryAt).toISOString() }]);
  });

  it("sin el ejecutable de Claude devuelve el trabajo sin gastar intento y se pausa", async () => {
    const { api, reports } = fakeApi(JOB);
    const step = await processOnce(
      deps(api, async () => {
        throw new CliNotFoundError("claude");
      }),
    );
    expect(step).toMatchObject({ kind: "pause", untilMs: NOW + CLI_MISSING_PAUSE_MS, code: "worker_no_disponible" });
    expect(reports[0]).toMatchObject({ outcome: "limite", errorCode: "worker_no_disponible" });
  });

  it("reintenta el envío del resultado si la app no responde", async () => {
    let calls = 0;
    const api: AppApi = {
      claim: async () => ({ job: JOB, paused: false }),
      status: async () => undefined,
      report: async () => {
        calls++;
        if (calls < 3) throw new Error("red");
      },
    };
    await processOnce(deps(api, async () => ({ kind: "error", code: "cli_error", retryable: true, detail: "x" })));
    expect(calls).toBe(3);
  });

  it("no reintenta si la app rechaza el resultado con 4xx (p. ej. reserva vencida)", async () => {
    let calls = 0;
    const api: AppApi = {
      claim: async () => ({ job: JOB, paused: false }),
      status: async () => undefined,
      report: async () => {
        calls++;
        throw new AppApiError("la app respondió 404", 404);
      },
    };
    const step = await processOnce(
      deps(api, async () => ({ kind: "ok", output: {}, usage: { inputTokens: 0, outputTokens: 0 } })),
    );
    expect(step).toEqual({ kind: "done" });
    expect(calls).toBe(1);
  });
});

describe("configuración", () => {
  it("exige la URL y un secreto de 32 caracteres; el resto tiene valores por defecto", () => {
    expect(() => loadConfig({})).toThrow(/IA_WORKER_APP_URL/);
    expect(() => loadConfig({ IA_WORKER_APP_URL: "https://app.test", IA_WORKER_SECRET: "corto" })).toThrow(/IA_WORKER_SECRET/);
    // El tiempo por CV no puede superar la reserva de 10 min (máx. 480 s).
    expect(() =>
      loadConfig({ IA_WORKER_APP_URL: "https://app.test", IA_WORKER_SECRET: "s".repeat(32), IA_WORKER_TIMEOUT_SECONDS: "900" }),
    ).toThrow(/IA_WORKER_TIMEOUT_SECONDS/);
    expect(loadConfig({ IA_WORKER_APP_URL: "https://app.test", IA_WORKER_SECRET: "s".repeat(32) })).toEqual({
      appUrl: "https://app.test",
      secret: "s".repeat(32),
      cliPath: "claude",
      pollMs: 10_000,
      timeoutMs: 300_000,
      concurrency: 1,
      modelOverride: undefined,
    });
  });
});
