import { describe, expect, it } from "vitest";
import { loadConfig, loadRepairConfig } from "../../bot/src/config";
import { askModel, buildClaudeCliArgs, buildClaudeCliEnv, createClaudeCliComplete, createCompleteFromConfig, type ProcessOutput, type RunProcess } from "../../bot/src/repair/client";

const env = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };
const RESPUESTA = { sin_propuesta: false, clave: "publicar.boton", selector: "button#nuevo", confianza: "media", razon: "El botón cambió de id." };
const request = { model: "claude-sonnet-5-5", system: "Eres un asistente.", prompt: "Esquema: …" };

/** Envoltorio como el que imprime `claude --output-format json`. */
function envelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    stop_reason: "end_turn",
    result: JSON.stringify(RESPUESTA),
    usage: { input_tokens: 5, output_tokens: 30, cache_creation_input_tokens: 700, cache_read_input_tokens: 100 },
    ...over,
  });
}

/** `runImpl` falso: nunca ejecuta el CLI real. */
function fakeRun(output: Partial<ProcessOutput>): RunProcess {
  return async () => ({ code: 0, stdout: "", stderr: "", timedOut: false, ...output });
}

describe("configuración del proveedor claude-cli (suscripción vía el CLI de Claude Code)", () => {
  it("se activa sin clave ni dirección, con el modelo y el ejecutable por defecto", () => {
    expect(loadRepairConfig({ BOT_REPAIR_PROVIDER: "claude-cli" })).toMatchObject({
      repairEnabled: true,
      repairProvider: "claude-cli",
      repairBaseUrl: null,
      repairCliPath: "claude",
      repairModel: "claude-sonnet-5-5",
    });
  });

  it("no necesita ANTHROPIC_API_KEY y admite ruta y modelo propios", () => {
    const config = loadRepairConfig({ BOT_REPAIR_PROVIDER: "claude-cli", BOT_REPAIR_CLI_PATH: "C:\\bin\\claude.exe", BOT_REPAIR_MODEL: "claude-opus-5-5" });
    expect(config).toMatchObject({ repairEnabled: true, repairCliPath: "C:\\bin\\claude.exe", repairModel: "claude-opus-5-5" });
  });

  it("el tope diario 0 lo apaga, también llegando por loadConfig", () => {
    expect(loadRepairConfig({ BOT_REPAIR_PROVIDER: "claude-cli", BOT_REPAIR_MAX_PER_DAY: "0" }).repairEnabled).toBe(false);
    expect(loadConfig({ ...env, BOT_REPAIR_PROVIDER: "claude-cli" }).repairEnabled).toBe(true);
    expect(loadConfig({ ...env, BOT_REPAIR_PROVIDER: "claude-cli", BOT_REPAIR_MAX_PER_DAY: "0" }).repairEnabled).toBe(false);
  });

  it("un proveedor desconocido sigue siendo un error", () => {
    expect(() => loadRepairConfig({ BOT_REPAIR_PROVIDER: "gemini" })).toThrow(/BOT_REPAIR_PROVIDER/);
  });

  it("createCompleteFromConfig enruta a claude-cli sin ejecutar nada", () => {
    const config = loadRepairConfig({ BOT_REPAIR_PROVIDER: "claude-cli" });
    expect(typeof createCompleteFromConfig(config)).toBe("function");
  });
});

describe("buildClaudeCliArgs", () => {
  const args = buildClaudeCliArgs("claude-sonnet-5-5", "Eres un asistente.", "Esquema: …");

  it("usa el modo print con salida JSON y el modelo indicado", () => {
    expect(args).toContain("-p");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args[args.indexOf("-p") + 1]).toBe("Esquema: …");
  });

  it("reemplaza el prompt de sistema e incluye la instrucción del JSON", () => {
    const system = args[args.indexOf("--system-prompt") + 1];
    expect(system).toContain("Eres un asistente.");
    expect(system).toContain("sin_propuesta"); // le explica el esquema esperado
  });

  it("aísla la llamada: sin herramientas, sin settings del proyecto, sin MCP", () => {
    expect(args[args.indexOf("--tools") + 1]).toBe(""); // "" = desactiva todas las herramientas
    expect(args).toContain("--restricted");
    expect(args).toContain("--strict-mcp-config");
  });
});

describe("buildClaudeCliEnv", () => {
  it("quita las claves de API para forzar el uso de la suscripción (no facturar por API)", () => {
    const env = buildClaudeCliEnv({ NODE_ENV: "test", ANTHROPIC_API_KEY: "sk-xxx", ANTHROPIC_AUTH_TOKEN: "tok", PATH: "/bin", OTRA: "1" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env).toMatchObject({ PATH: "/bin", OTRA: "1" }); // lo demás se conserva
  });
});

describe("createClaudeCliComplete contra un CLI simulado", () => {
  it("entiende una respuesta correcta y suma el contexto cacheado al consumo", async () => {
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 5_000, runImpl: fakeRun({ stdout: envelope() }) });
    const answer = await askModel(complete, request);
    // tokensEntrada = input (5) + cache_creation (700) + cache_read (100)
    expect(answer).toMatchObject({ ok: true, respuesta: RESPUESTA, tokensEntrada: 805, tokensSalida: 30 });
  });

  it("pasa el modelo y el prompt al CLI", async () => {
    let seen: string[] = [];
    const runImpl: RunProcess = async (_cli, args) => {
      seen = args;
      return { code: 0, stdout: envelope(), stderr: "", timedOut: false };
    };
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 5_000, runImpl });
    await complete(request);
    expect(seen[seen.indexOf("--model") + 1]).toBe("claude-sonnet-5-5");
    expect(seen[seen.indexOf("-p") + 1]).toBe("Esquema: …");
  });

  it("quita el razonamiento y las vallas que el modelo pudiera añadir dentro de result", async () => {
    const stdout = envelope({ result: "```json\n" + JSON.stringify(RESPUESTA) + "\n```" });
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 5_000, runImpl: fakeRun({ stdout }) });
    expect((await askModel(complete, request)).ok).toBe(true);
  });

  it("subtype error_max_turns se traduce a corte (max_tokens), sin propuesta", async () => {
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 5_000, runImpl: fakeRun({ stdout: envelope({ subtype: "error_max_turns", is_error: true, result: "" }) }) });
    expect(await askModel(complete, request)).toMatchObject({ ok: false, motivo: expect.stringContaining("max_tokens") });
  });

  it("un error del CLI (is_error) lanza con el motivo", async () => {
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 5_000, runImpl: fakeRun({ stdout: envelope({ subtype: "error_during_execution", is_error: true, result: "algo salió mal" }) }) });
    await expect(complete(request)).rejects.toThrow(/claude devolvió un error.*algo salió mal/);
  });

  it("código de salida distinto de 0 (p. ej. sesión caducada) lanza con el mensaje del CLI", async () => {
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 5_000, runImpl: fakeRun({ code: 1, stdout: "", stderr: "Invalid credentials. Please run claude to log in." }) });
    await expect(complete(request)).rejects.toThrow(/claude terminó con error.*log in/);
  });

  it("si el CLI no responde a tiempo, avisa", async () => {
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 4_000, runImpl: fakeRun({ timedOut: true, code: null }) });
    await expect(complete(request)).rejects.toThrow(/no respondió en 4 s/);
  });

  it("una salida que no es JSON no da propuesta (lanza)", async () => {
    const complete = createClaudeCliComplete({ cliPath: "claude", timeoutMs: 5_000, runImpl: fakeRun({ stdout: "no soy json" }) });
    await expect(complete(request)).rejects.toThrow(/no es JSON/);
  });
});
