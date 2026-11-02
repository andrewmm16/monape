import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

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
