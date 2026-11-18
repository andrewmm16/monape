import { z } from "zod";
import { normalizeLearnedTerm } from "../learned";
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
      // Desde ia-prompt-v4: el término del CV que resolvió la duda del motor (para que el motor aprenda).
      equivalence: z.object({ cv_term: z.string(), equivalent: z.boolean() }).nullable().optional(),
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

/** Lo que la IA dijo de un término del CV frente a un requisito: un voto para que el motor aprenda. */
export type EquivalenceVote = {
  requirementId: string;
  /** Término normalizado y tal como está en el CV. */
  term: string;
  display: string;
  equivalent: boolean;
  rationale: string;
};

/**
 * Votos de la IA (campo `equivalence`), solo los verificables: el término debe
 * aparecer literalmente en el texto enviado, tener de 1 a 6 palabras y referirse
 * a un requisito no esencial. Nunca lanza: una salida rara simplemente no vota.
 */
export function extractEquivalenceVotes(raw: unknown, requirements: RequirementInput[], sourceText: string): EquivalenceVote[] {
  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) return [];
  const source = normalizeForSearch(sourceText);
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const votes: EquivalenceVote[] = [];
  for (const item of parsed.data.items) {
    const requirement = byId.get(item.requirement_id);
    if (!requirement || requirement.isEssential || !item.equivalence || seen.has(item.requirement_id)) continue;
    const term = normalizeLearnedTerm(item.equivalence.cv_term);
    if (!term || !containsQuote(source, term.display)) continue;
    seen.add(item.requirement_id);
    votes.push({
      requirementId: requirement.id,
      term: term.term,
      display: term.display,
      equivalent: item.equivalence.equivalent,
      rationale: item.rationale.trim().slice(0, 600),
    });
  }
  return votes;
}
