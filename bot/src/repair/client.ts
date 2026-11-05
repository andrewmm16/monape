import { spawn } from "node:child_process";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { BotConfig } from "../config";

/**
 * Cliente de la reparación asistida. Usa el SDK oficial (`new Anthropic()` lee `ANTHROPIC_API_KEY`
 * del entorno; la clave nunca se guarda ni se registra). Reglas de la API para `claude-sonnet-5-5`:
 *   - NO se envían `temperature`, `top_p` ni `top_k` (la API responde 400).
 *   - NO se usa prefill de la respuesta ni `tool_choice` forzado.
 *   - NO se envía `thinking: { type: "disabled" }` (400): se omite `thinking` y se fija `output_config.effort`.
 *   - La salida estructurada va en `output_config.format` (json_schema) y aquí se vuelve a validar con zod.
 *   - Se revisa `stop_reason`: `refusal` y `max_tokens` no producen propuesta.
 * El cliente es inyectable (`Complete`) para que las pruebas nunca llamen a la API real.
 */

export const MAX_OUTPUT_TOKENS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;

export interface CompleteRequest {
  model: string;
  system: string;
  prompt: string;
}

export interface CompleteResult {
  /** Texto de la respuesta (JSON según el esquema); `null` si no hubo texto. */
  text: string | null;
  stopReason: string | null;
  tokensEntrada: number;
  tokensSalida: number;
}

/** Una consulta al modelo. La real usa el SDK; las pruebas pasan una función simulada. */
export type Complete = (request: CompleteRequest) => Promise<CompleteResult>;

/** Esquema de la salida estructurada. */
export const RESPUESTA_SCHEMA = {
  type: "object",
  properties: {
    sin_propuesta: { type: "boolean", description: "true si no se puede proponer un selector con seguridad." },
    clave: { type: "string", description: "Clave del libro de selectores afectada (vacía si no hay propuesta)." },
    selector: { type: "string", description: "Selector CSS nuevo (vacío si no hay propuesta)." },
    confianza: { type: "string", enum: ["baja", "media", "alta"] },
    razon: { type: "string", description: "Motivo breve, en español." },
  },
  required: ["sin_propuesta", "clave", "selector", "confianza", "razon"],
  additionalProperties: false,
} as const;

/** Lo que el modelo devuelve, validado por nosotros (no se confía en el esquema del lado del modelo). */
export const respuestaZ = z.object({
  sin_propuesta: z.boolean(),
  clave: z.string().max(100),
  selector: z.string().max(2_000),
  confianza: z.enum(["baja", "media", "alta"]),
  razon: z.string().max(2_000),
});

export type Respuesta = z.infer<typeof respuestaZ>;

/** Cliente real. Se crea solo cuando la reparación está activa (hay `ANTHROPIC_API_KEY`). */
export function createAnthropicComplete(): Complete {
  let client: Anthropic | undefined;
  return async ({ model, system, prompt }) => {
    client ??= new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES });
    const response = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "low", format: { type: "json_schema", schema: RESPUESTA_SCHEMA } },
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return {
      text: text || null,
      stopReason: response.stop_reason,
      tokensEntrada: response.usage.input_tokens,
      tokensSalida: response.usage.output_tokens,
    };
  };
}

// ---------------------------------------------------------------------------------------------
// Servidor compatible con OpenAI (`POST {base}/chat/completions`): vLLM, Ollama, LiteLLM, un Qwen propio…
// Solo usa `fetch` (sin dependencias). No se envía nada que no vaya ya a Anthropic: el esquema saneado y el
// mensaje saneado del incidente. La clave (opcional) viaja en `Authorization` y nunca se registra.
// ---------------------------------------------------------------------------------------------

/** Los modelos que razonan en voz alta (Qwen3…) gastan tokens antes del JSON: más margen que con Anthropic. */
export const OPENAI_MAX_OUTPUT_TOKENS = 4_000;
const OPENAI_RETRY_DELAY_MS = 1_000;

/** Qué JSON se espera: se explica en el texto porque no todos los servidores admiten `response_format`. */
const JSON_INSTRUCTION =
  "Responda ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después y sin bloque de código, con exactamente estas claves: " +
  "sin_propuesta (booleano), clave (texto), selector (texto), confianza («baja», «media» o «alta») y razon (texto breve en español). " +
  `Esquema: ${JSON.stringify(RESPUESTA_SCHEMA)}`;

/**
 * Deja solo el JSON de la respuesta de un modelo "hablador": quita los bloques `<think>…</think>` de Qwen3 y las vallas
 * ```` ```json ````, y si aún sobra texto toma desde la primera `{` hasta la última `}`. Si no hay JSON devuelve el texto tal cual.
 */
export function extractJsonText(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();
  try {
    JSON.parse(text);
    return text;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start !== -1 && end > start ? text.slice(start, end + 1) : text;
  }
}

export interface OpenAICompatOptions {
  /** Termina en `/v1` (sin barra final). */
  baseUrl: string;
  /** Opcional: muchos servidores internos no piden clave. */
  apiKey?: string;
  jsonMode: "prompt" | "schema";
  timeoutMs: number;
  /** Solo para pruebas. */
  fetchImpl?: typeof fetch;
}

interface ChatCompletionBody {
  choices?: { message?: { content?: unknown }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Texto de `message.content`: casi siempre una cadena; algunos servidores devuelven una lista de partes `{type:"text", text}`. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("");
  }
  return "";
}

export function createOpenAICompatComplete(options: OpenAICompatOptions): Complete {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = options.fetchImpl ?? fetch;

  async function post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    return doFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs) });
  }

  return async ({ model, system, prompt }) => {
    const body = {
      model,
      max_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      temperature: 0,
      messages: [
        { role: "system", content: `${system}\n\n${JSON_INSTRUCTION}` },
        { role: "user", content: prompt },
      ],
      ...(options.jsonMode === "schema"
        ? { response_format: { type: "json_schema", json_schema: { name: "propuesta_selector", strict: true, schema: RESPUESTA_SCHEMA } } }
        : {}),
    };
    let response: Response;
    try {
      response = await post(body);
      // Un solo reintento ante un corte momentáneo o un servidor saturado (como el SDK de Anthropic).
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, OPENAI_RETRY_DELAY_MS));
        response = await post(body);
      }
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new Error(`el servidor del modelo no respondió en ${Math.round(options.timeoutMs / 1000)} s`);
      }
      throw new Error(`no se pudo conectar con el servidor del modelo (${error instanceof Error ? error.message : String(error)})`);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      throw new Error(`el servidor del modelo respondió ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = (await response.json().catch(() => ({}))) as ChatCompletionBody;
    const choice = data.choices?.[0];
    const finish = choice?.finish_reason ?? null;
    const text = extractJsonText(contentText(choice?.message?.content));
    return {
      text: text || null,
      // Misma nomenclatura que Anthropic para que `askModel` no distinga proveedores.
      stopReason: finish === "length" ? "max_tokens" : finish === "content_filter" ? "refusal" : finish,
      tokensEntrada: data.usage?.prompt_tokens ?? 0,
      tokensSalida: data.usage?.completion_tokens ?? 0,
    };
  };
}

// ---------------------------------------------------------------------------------------------
// CLI de Claude Code en modo headless (`claude -p … --output-format json`): usa la sesión iniciada
// del desarrollador (su suscripción vía OAuth) en LA MISMA PC del robot, sin ANTHROPIC_API_KEY de pago.
// El coste que informa el CLI es una ESTIMACIÓN a precio de lista (`costBasis: "list"`), no un cargo:
// con la suscripción cuenta contra los límites del plan. No se envía nada que no vaya ya a Anthropic
// (el esquema saneado y el mensaje saneado del incidente). La sesión y sus tokens no se leen ni se guardan.
//
// La llamada se aísla al máximo: `--system-prompt` REEMPLAZA el prompt de sistema del agente (sin el preámbulo
// de programación: ~730 tokens de contexto en vez de ~38k), `--tools ""` desactiva todas las herramientas,
// `--restricted` ignora los settings y el CLAUDE.md del proyecto, y `--strict-mcp-config` omite los servidores MCP.
// ---------------------------------------------------------------------------------------------

function oneLineClip(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Argumentos del CLI para una consulta de reparación. Exportado para poder probarlo sin ejecutar nada. */
export function buildClaudeCliArgs(model: string, system: string, prompt: string): string[] {
  return [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    model,
    // El CLI reemplaza su prompt de sistema por el nuestro: menos tokens y nada de identidad de agente de código.
    "--system-prompt",
    `${system}\n\n${JSON_INSTRUCTION}`,
    // Defensa en profundidad: sin herramientas, sin settings del proyecto, sin MCP. Solo una respuesta de texto.
    "--tools",
    "",
    "--restricted",
    "--strict-mcp-config",
  ];
}

/** Envoltorio JSON que imprime `claude --output-format json`. Solo se leen los campos que usamos. */
interface ClaudeCliEnvelope {
  subtype?: string;
  is_error?: boolean;
  stop_reason?: string | null;
  result?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface ProcessOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Ejecuta el proceso y recoge su salida. Inyectable para que las pruebas no llamen al CLI real. */
export type RunProcess = (cliPath: string, args: string[], timeoutMs: number) => Promise<ProcessOutput>;

/**
 * Entorno del proceso hijo. Se QUITAN las claves de API (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`): este proveedor
 * usa la sesión iniciada de `claude` (la suscripción), y así se evita facturar por la API de pago sin querer.
 */
export function buildClaudeCliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

const spawnRun: RunProcess = (cliPath, args, timeoutMs) =>
  new Promise<ProcessOutput>((resolve, reject) => {
    // En un directorio neutro: aunque `--restricted` ya ignora los settings, así no se carga ningún CLAUDE.md del cwd.
    const child = spawn(cliPath, args, { cwd: os.tmpdir(), windowsHide: true, env: buildClaudeCliEnv() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new Error(
          error.code === "ENOENT"
            ? `no se encontró el ejecutable «${cliPath}»: inicie sesión con «claude» en la PC del robot o configure BOT_REPAIR_CLI_PATH con su ruta completa`
            : `no se pudo ejecutar claude: ${error.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

export interface ClaudeCliOptions {
  /** Ruta o nombre del ejecutable (por defecto «claude», que debe estar en el PATH del robot). */
  cliPath: string;
  timeoutMs: number;
  /** Solo para pruebas. */
  runImpl?: RunProcess;
}

export function createClaudeCliComplete(options: ClaudeCliOptions): Complete {
  const run = options.runImpl ?? spawnRun;
  const seconds = Math.round(options.timeoutMs / 1_000);
  return async ({ model, system, prompt }) => {
    const out = await run(options.cliPath, buildClaudeCliArgs(model, system, prompt), options.timeoutMs);
    if (out.timedOut) throw new Error(`claude no respondió en ${seconds} s`);
    if (out.code !== 0 || !out.stdout.trim()) {
      // Caso típico: la sesión de «claude» caducó o no hay login. El mensaje (sin secretos) llega al log del robot.
      const detail = oneLineClip(out.stderr || out.stdout, 200);
      throw new Error(`claude terminó con error${out.code !== null && out.code !== 0 ? ` (código ${out.code})` : ""}${detail ? `: ${detail}` : ""}`);
    }
    let envelope: ClaudeCliEnvelope;
    try {
      envelope = JSON.parse(out.stdout) as ClaudeCliEnvelope;
    } catch {
      throw new Error(`la salida de claude no es JSON: ${oneLineClip(out.stdout, 200)}`);
    }
    const u = envelope.usage ?? {};
    const usage = {
      // El consumo real incluye el contexto cacheado (cuenta contra el plan), no solo input_tokens.
      tokensEntrada: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      tokensSalida: u.output_tokens ?? 0,
    };
    if (envelope.subtype === "error_max_turns") return { text: null, stopReason: "max_tokens", ...usage };
    if (envelope.is_error || (envelope.subtype && envelope.subtype !== "success")) {
      const detail = typeof envelope.result === "string" ? oneLineClip(envelope.result, 200) : "";
      throw new Error(`claude devolvió un error (${envelope.subtype ?? "desconocido"})${detail ? `: ${detail}` : ""}`);
    }
    const text = extractJsonText(typeof envelope.result === "string" ? envelope.result : "");
    return {
      text: text || null,
      // Misma nomenclatura que Anthropic/OpenAI para que `askModel` no distinga proveedores.
      stopReason: envelope.stop_reason ?? null,
      ...usage,
    };
  };
}

/** El cliente según la configuración. La clave (si la hay) se lee del entorno aquí y no se guarda en ningún otro sitio. */
export function createCompleteFromConfig(
  config: Pick<BotConfig, "repairProvider" | "repairBaseUrl" | "repairJsonMode" | "repairTimeoutSeconds" | "repairCliPath">,
  env: Record<string, string | undefined> = process.env,
): Complete {
  if (config.repairProvider === "openai") {
    if (!config.repairBaseUrl) throw new Error("Falta BOT_REPAIR_BASE_URL para el proveedor openai.");
    return createOpenAICompatComplete({
      baseUrl: config.repairBaseUrl,
      apiKey: (env.BOT_REPAIR_API_KEY ?? "").trim() || undefined,
      jsonMode: config.repairJsonMode,
      timeoutMs: config.repairTimeoutSeconds * 1_000,
    });
  }
  if (config.repairProvider === "claude-cli") {
    return createClaudeCliComplete({ cliPath: config.repairCliPath, timeoutMs: config.repairTimeoutSeconds * 1_000 });
  }
  return createAnthropicComplete();
}

export type AskResult =
  | { ok: true; respuesta: Respuesta; tokensEntrada: number; tokensSalida: number }
  | { ok: false; motivo: string; tokensEntrada: number; tokensSalida: number };

/** Pregunta al modelo y valida la respuesta. Un rechazo, un corte o un JSON inválido no dan propuesta (solo motivo para el log). */
export async function askModel(complete: Complete, request: CompleteRequest): Promise<AskResult> {
  const result = await complete(request);
  const usage = { tokensEntrada: result.tokensEntrada, tokensSalida: result.tokensSalida };
  if (result.stopReason === "refusal") return { ok: false, motivo: "el modelo rechazó la consulta (refusal)", ...usage };
  if (result.stopReason === "max_tokens") return { ok: false, motivo: "la respuesta del modelo se cortó (max_tokens)", ...usage };
  if (!result.text) return { ok: false, motivo: "el modelo no devolvió texto", ...usage };
  let json: unknown;
  try {
    json = JSON.parse(result.text);
  } catch {
    return { ok: false, motivo: "la respuesta del modelo no es JSON", ...usage };
  }
  const parsed = respuestaZ.safeParse(json);
  if (!parsed.success) return { ok: false, motivo: "la respuesta del modelo no cumple el formato esperado", ...usage };
  return { ok: true, respuesta: parsed.data, ...usage };
}
