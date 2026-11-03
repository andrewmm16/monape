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

/** El cliente según la configuración. La clave se lee del entorno aquí y no se guarda en ningún otro sitio. */
export function createCompleteFromConfig(
  config: Pick<BotConfig, "repairProvider" | "repairBaseUrl" | "repairJsonMode" | "repairTimeoutSeconds">,
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
