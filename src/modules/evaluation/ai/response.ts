import { z } from "zod";
import { containsQuote, normalizeForSearch } from "../text";
import type { Assessment, ItemAssessment, RequirementInput } from "../types";

/** Esquema de salida estructurada solicitado al modelo. */
export const aiOutputSchema = z.object({
  items: z.array(
    z.object({
      requirement_id: z.string(),
      assessment: z.enum(["acreditado", "no_cumplido", "sin_evidencia", "pendiente_verificacion"]),
      evidence_quotes: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;

export class InvalidAiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAiResponseError";
  }
}

const MAX_QUOTES = 3;
const MAX_QUOTE_LENGTH = 300;
const MAX_RATIONALE_LENGTH = 600;

/**
 * Valida la respuesta del modelo y la contrasta con el texto realmente
 * enviado. Nunca confía en el modelo para:
 *  - inventar requisitos (se ignoran identificadores desconocidos);
 *  - omitir requisitos (los faltantes quedan pendientes de verificación);
 *  - afirmar sin evidencia (acreditado/no cumplido sin cita literal verificable
 *    pasa a pendiente de verificación);
 *  - acreditar requisitos legales/esenciales (siempre requieren verificación humana).
 */
export function interpretAiResponse(
  raw: unknown,
  requirements: RequirementInput[],
  sourceText: string,
): ItemAssessment[] {
  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidAiResponseError("La respuesta del modelo no cumple el formato esperado.");
  }

  const source = normalizeForSearch(sourceText);
  const byId = new Map<string, AiOutput["items"][number]>();
  for (const item of parsed.data.items) {
    if (!byId.has(item.requirement_id)) byId.set(item.requirement_id, item);
  }

  return requirements.map((requirement): ItemAssessment => {
    const item = byId.get(requirement.id);
    if (!item) {
      return {
        requirementId: requirement.id,
        assessment: "pendiente_verificacion",
        evidence: [],
        rationale: "El modelo no evaluó este requisito. Requiere revisión manual.",
      };
    }

    const quotes = item.evidence_quotes
      .map((quote) => quote.trim().slice(0, MAX_QUOTE_LENGTH))
      .filter((quote) => quote.length > 0);
    const verified = quotes.filter((quote) => containsQuote(source, quote)).slice(0, MAX_QUOTES);
    const discarded = quotes.length - verified.length;
    const rationale = item.rationale.trim().slice(0, MAX_RATIONALE_LENGTH) || "Sin justificación del modelo.";
    const notes: string[] = [];
    let assessment: Assessment = item.assessment;

    if (discarded > 0) {
      notes.push(`Se descartaron ${discarded} cita(s) que no aparecen literalmente en el CV.`);
    }
    if ((assessment === "acreditado" || assessment === "no_cumplido") && verified.length === 0) {
      assessment = "pendiente_verificacion";
      notes.push("El modelo no aportó una cita verificable del CV; se requiere verificación humana.");
    }
    if (assessment === "acreditado" && requirement.isEssential) {
      assessment = "pendiente_verificacion";
      notes.push("Requisito legal o esencial: debe verificarse con documentos.");
    }

    return {
      requirementId: requirement.id,
      assessment,
      evidence: verified.map((quote) => ({ quote })),
      rationale: [rationale, ...notes].join(" "),
    };
  });
}
