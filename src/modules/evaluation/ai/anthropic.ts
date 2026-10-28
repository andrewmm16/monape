import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AppError } from "@/lib/errors";
import { aiOutputSchema, InvalidAiResponseError } from "./response";

export type AiRequest = {
  apiKey: string;
  model: string;
  system: string;
  userMessage: string;
};

/**
 * Solicita al modelo una valoración estructurada. La respuesta se devuelve
 * sin interpretar: `interpretAiResponse` la valida y contrasta con el CV.
 */
export async function requestAnthropicAssessment(request: AiRequest): Promise<{ raw: unknown; model: string }> {
  const client = new Anthropic({ apiKey: request.apiKey, timeout: 120_000, maxRetries: 2 });
  try {
    const response = await client.beta.messages.parse({
      model: request.model,
      max_tokens: 16_000,
      // Si el modelo declina por política, la API reintenta en el modelo
      // alternativo que defina el servidor.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: request.system,
      messages: [{ role: "user", content: request.userMessage }],
      output_config: {
        effort: "medium",
        format: betaZodOutputFormat(aiOutputSchema),
      },
    });

    if (response.stop_reason === "refusal") {
      throw new AppError(
        "El modelo declinó evaluar este CV. Use el motor de reglas o realice la evaluación manualmente.",
        "unavailable",
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new InvalidAiResponseError("La respuesta del modelo quedó incompleta.");
    }
    return { raw: response.parsed_output, model: response.model };
  } catch (error) {
    if (error instanceof AppError || error instanceof InvalidAiResponseError) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new AppError("Las credenciales del proveedor de IA no son válidas.", "unavailable");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AppError("El proveedor de IA está limitando las solicitudes. Intente más tarde.", "rate_limited");
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AppError("No se pudo conectar con el proveedor de IA.", "unavailable");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AppError(`El proveedor de IA respondió con un error (${error.status ?? "sin código"}).`, "unavailable");
    }
    // Errores de análisis de la salida estructurada.
    throw new InvalidAiResponseError("No se pudo interpretar la respuesta del modelo.");
  }
}
