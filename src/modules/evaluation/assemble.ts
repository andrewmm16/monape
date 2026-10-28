import { COMPATIBILITY_LEVEL_LABELS } from "@/lib/labels";
import { buildLimitations, buildSummary, computeScores, determineLevel, SCORING_VERSION } from "./scoring";
import type { EvaluationMethod, EvaluationResult, ItemAssessment, RequirementInput } from "./types";

/**
 * Une las valoraciones por requisito con la metodología de puntuación.
 * Es puro y determinista: mismas entradas → mismo resultado.
 */
export function assembleEvaluation(input: {
  method: EvaluationMethod;
  methodVersion: string;
  model: string | null;
  requirements: RequirementInput[];
  items: ItemAssessment[];
  textWasCorrected: boolean;
  textTruncated: boolean;
}): EvaluationResult {
  const byId = new Map(input.items.map((item) => [item.requirementId, item]));
  const enriched = input.requirements.map((requirement) => {
    const item = byId.get(requirement.id);
    if (!item) throw new Error(`Falta la valoración del requisito ${requirement.id}`);
    return { ...item, weight: requirement.weight, priority: requirement.priority, isEssential: requirement.isEssential };
  });

  const scores = computeScores(enriched);
  const level = determineLevel(scores, enriched);

  return {
    method: input.method,
    methodVersion: input.methodVersion,
    scoringVersion: SCORING_VERSION,
    model: input.model,
    items: enriched.map(({ requirementId, assessment, evidence, rationale }) => ({
      requirementId,
      assessment,
      evidence,
      rationale,
    })),
    scores,
    level,
    summary: buildSummary(enriched, scores, COMPATIBILITY_LEVEL_LABELS[level]),
    limitations: buildLimitations({
      method: input.method,
      scores,
      items: enriched,
      textWasCorrected: input.textWasCorrected,
      textTruncated: input.textTruncated,
    }),
  };
}
