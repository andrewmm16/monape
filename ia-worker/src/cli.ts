import { spawn } from "node:child_process";
import os from "node:os";
import type { Job } from "./types";

/**
 * Ejecución del CLI oficial de Claude Code en modo headless
 * (`claude -p … --output-format json --json-schema …`) con la suscripción.
 *
 * Aislamiento: `--system-prompt` reemplaza el prompt de agente de código,
 * `--tools ""` quita todas las herramientas, `--restricted` ignora los settings
 * del usuario y del proyecto, `--strict-mcp-config` omite los servidores MCP y
 * `--no-session-persistence` no guarda la sesión (ni el CV) en disco. El CV
 * viaja por stdin (no por la línea de comandos, que tiene límite de tamaño y
 * es visible para otros procesos).
 */

export type CliOutcome =
  | { kind: "ok"; output: unknown; model?: string; usage: Usage }
  /** El proveedor no se puede usar por ahora: límite del plan o sesión inválida. */
  | { kind: "limit"; code: "limite_plan" | "sin_sesion"; retryAt?: number; detail: string }
  | { kind: "error"; code: string; retryable: boolean; detail: string };

export type Usage = { inputTokens: number; outputTokens: number };

export type ProcessOutput = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Ejecuta el proceso con `stdin`. Inyectable para probar sin llamar al CLI real. */
export type RunProcess = (cliPath: string, args: string[], stdin: string, timeoutMs: number) => Promise<ProcessOutput>;

export class CliNotFoundError extends Error {
  constructor(cliPath: string) {
    super(`no se encontró el ejecutable «${cliPath}»: instale Claude Code o configure IA_WORKER_CLI_PATH con su ruta completa`);
    this.name = "CliNotFoundError";
  }
}

export function buildClaudeArgs(job: Pick<Job, "model" | "system" | "schema" | "effort">): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    job.model,
    "--system-prompt",
    job.system,
    "--json-schema",
    JSON.stringify(job.schema),
    ...(job.effort ? ["--effort", job.effort] : []),
    "--tools",
    "",
    "--restricted",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
}

/** Variables que parecen secretos y no necesita el CLI (claves de la app, Supabase, otros servicios). */
const SECRET_NAME_RE = /SECRET|PASSWORD|PASSWD|PRIVATE|API_KEY|ACCESS_KEY|_TOKEN$/i;

/**
 * Entorno del proceso hijo:
 * - sin claves de la API de Anthropic, para que el consumo nunca se facture por
 *   la API de pago (el CLI usa CLAUDE_CODE_OAUTH_TOKEN o la sesión iniciada);
 * - sin la configuración del worker ni nada que parezca un secreto, salvo
 *   CLAUDE_CODE_OAUTH_TOKEN, que es justamente la credencial del CLI;
 * - sin actualización automática, para que el CLI no cambie solo en
 *   producción (actualícelo a mano y pruebe).
 */
export function buildChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(base)) {
    if (name === "CLAUDE_CODE_OAUTH_TOKEN") env[name] = value;
    else if (name.startsWith("IA_WORKER_") || name.startsWith("ANTHROPIC_") || SECRET_NAME_RE.test(name)) continue;
    else env[name] = value;
  }
  env.DISABLE_AUTOUPDATER = "1";
  return env as NodeJS.ProcessEnv;
}

export const spawnRun: RunProcess = (cliPath, args, stdin, timeoutMs) =>
  new Promise<ProcessOutput>((resolve, reject) => {
    // Directorio neutro: no se carga ningún CLAUDE.md ni configuración de proyecto.
    const child = spawn(cliPath, args, { cwd: os.tmpdir(), windowsHide: true, env: buildChildEnv() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new CliNotFoundError(cliPath) : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {
      // El proceso puede cerrar stdin antes de leerlo todo (p. ej. si falla al arrancar): lo informa `close`.
    });
    child.stdin.end(stdin, "utf8");
  });

/** Envoltorio de `claude --output-format json`. Solo los campos que se usan. */
type Envelope = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  api_error_status?: number | null;
  result?: unknown;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
};

/** Pausa por defecto cuando no se conoce la hora de renovación del límite. */
export const DEFAULT_LIMIT_PAUSE_MS = 15 * 60 * 1_000;
/** Pausa cuando la sesión no es válida (hay que renovar el token). */
export const AUTH_PAUSE_MS = 10 * 60 * 1_000;

// Solo los mensajes propios del CLI y de la API: un patrón genérico podría tomar por límite un fallo
// de un CV concreto, y el límite no cuenta como intento (el trabajo esperaría sin fin). Los 429,
// 401 y 403 se reconocen por `api_error_status`.
const LIMIT_RE = /usage limit reached|hit your (?:usage |session |weekly )?limit|out of extra usage/i;
const AUTH_RE =
  /not logged in|please run \/login|invalid api key|oauth token (?:has )?(?:expired|been revoked)|only authorized for use with claude code/i;

/**
 * Texto para el log: corto, en una línea y sin datos de contacto. Solo se usa con mensajes de
 * error del CLI (nunca con la respuesta del modelo), pero por las dudas se enmascaran correos,
 * enlaces y números largos, por si un error citara parte del CV.
 */
function clip(text: string, max = 160): string {
  return text
    .replace(/\S+@\S+/g, "[correo]")
    .replace(/\bhttps?:\/\/\S+/gi, "[enlace]")
    .replace(/\d[\d\s-]{6,}\d/g, "[número]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Hora de renovación si el mensaje la trae como epoch (`…limit reached|1767225600`). */
export function parseResetEpoch(text: string): number | undefined {
  const match = /\|(\d{10})\b/.exec(text);
  return match ? Number(match[1]) * 1_000 : undefined;
}

/** JSON dentro de un texto, tolerando un bloque ```json … ```. */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1]! : trimmed);
  } catch {
    return undefined;
  }
}

function usageOf(envelope: Envelope): Usage {
  const u = envelope.usage ?? {};
  return {
    // Lo que cuenta contra el plan incluye el contexto cacheado.
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  };
}

function classifyFailure(text: string, apiStatus: number | null | undefined, now: number): CliOutcome {
  if (apiStatus === 429 || LIMIT_RE.test(text)) {
    return { kind: "limit", code: "limite_plan", retryAt: parseResetEpoch(text) ?? now + DEFAULT_LIMIT_PAUSE_MS, detail: clip(text) };
  }
  if (apiStatus === 401 || apiStatus === 403 || AUTH_RE.test(text)) {
    return { kind: "limit", code: "sin_sesion", retryAt: now + AUTH_PAUSE_MS, detail: clip(text) };
  }
  return { kind: "error", code: "cli_error", retryable: true, detail: clip(text) };
}

/** Interpreta la salida del CLI. `detail` solo lleva mensajes de error del CLI, recortados y enmascarados. */
export function parseCliOutput(out: ProcessOutput, now: number = Date.now()): CliOutcome {
  if (out.timedOut) return { kind: "error", code: "cli_timeout", retryable: true, detail: "el CLI no respondió a tiempo" };

  let envelope: Envelope | undefined;
  try {
    envelope = JSON.parse(out.stdout.trim()) as Envelope;
  } catch {
    envelope = undefined;
  }
  if (!envelope || typeof envelope !== "object") {
    // Sin envoltorio JSON: solo stderr (stdout podría traer cualquier cosa).
    return classifyFailure(out.stderr, null, now);
  }

  const resultText = typeof envelope.result === "string" ? envelope.result : "";
  if (envelope.is_error || (envelope.subtype && envelope.subtype !== "success") || out.code !== 0) {
    return classifyFailure(`${resultText}\n${out.stderr}`, envelope.api_error_status, now);
  }

  const output = envelope.structured_output ?? parseJsonText(resultText);
  if (output === undefined || output === null) {
    return { kind: "error", code: "salida_invalida", retryable: true, detail: "el modelo no devolvió JSON" };
  }
  const model = envelope.modelUsage ? Object.keys(envelope.modelUsage)[0] : undefined;
  return { kind: "ok", output, model, usage: usageOf(envelope) };
}

/** Ejecuta un trabajo con el CLI. `CliNotFoundError` se propaga (es un problema del worker, no del trabajo). */
export async function runClaude(
  job: Job,
  options: { cliPath: string; timeoutMs: number; runImpl?: RunProcess; now?: () => number },
): Promise<CliOutcome> {
  const run = options.runImpl ?? spawnRun;
  const out = await run(options.cliPath, buildClaudeArgs(job), job.prompt, options.timeoutMs);
  return parseCliOutput(out, (options.now ?? Date.now)());
}
