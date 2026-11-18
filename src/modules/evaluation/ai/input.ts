import { createHash } from "node:crypto";
import { z } from "zod";
import type { RequirementInput } from "../types";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt";
import { redactContactData } from "./redact";
import { aiOutputSchema } from "./response";

export type AiInput = {
  /** Texto del CV realmente enviado (datos de contacto reemplazados y, si hace falta, recortado). */
  evaluatedText: string;
  textTruncated: boolean;
  system: string;
  userMessage: string;
  /** SHA-256 del texto enviado: identifica lo evaluado y detecta cambios entre la reserva y el resultado. */
  inputSha256: string;
};

/**
 * Arma lo que se envía al modelo. Es puro y determinista: mismas entradas →
 * mismo prompt y misma huella. Lo comparten la evaluación directa (API) y la
 * cola (worker con la suscripción).
 */
export function buildAiInput(input: {
  vacancyTitle: string;
  requirements: RequirementInput[];
  fullText: string;
  maxChars: number;
}): AiInput {
  // Minimización: no se envían datos de contacto ni el nombre del archivo.
  let evaluatedText = redactContactData(input.fullText);
  let textTruncated = false;
  if (evaluatedText.length > input.maxChars) {
    evaluatedText = evaluatedText.slice(0, input.maxChars);
    textTruncated = true;
  }
  return {
    evaluatedText,
    textTruncated,
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage({ vacancyTitle: input.vacancyTitle, requirements: input.requirements, resumeText: evaluatedText }),
    inputSha256: createHash("sha256").update(evaluatedText).digest("hex"),
  };
}

/**
 * Esquema JSON de la salida estructurada, para el CLI de Claude (`--json-schema`).
 * Sin la clave `$schema`: el validador del CLI rechaza la meta-referencia
 * draft 2020-12 que añade Zod ("no schema with key or ref"), aunque el esquema
 * en sí sea compatible.
 */
export const AI_OUTPUT_JSON_SCHEMA: Record<string, unknown> = (() => {
  const schema = { ...(z.toJSONSchema(aiOutputSchema) as Record<string, unknown>) };
  delete schema.$schema;
  return schema;
})();
