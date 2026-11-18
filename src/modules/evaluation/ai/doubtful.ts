import { LEVEL_RULES } from "../scoring";
import type { EvaluationResult, RequirementInput } from "../types";

/** Distancia (en puntos) a un corte de nivel dentro de la cual el resultado se considera frontera. */
export const DOUBTFUL_MARGIN = 10;
/** Diferencia entre el máximo alcanzable y el puntaje a partir de la cual queda mucho por confirmar. */
export const DOUBTFUL_OPEN_GAP = 30;

/**
 * ¿Conviene una segunda opinión con IA sobre esta evaluación del motor?
 * Es donde se concentran sus falsos positivos y negativos:
 *  - nivel «pendiente» o «parcial» (falta evidencia o el resultado es intermedio);
 *  - puntaje a {@link DOUBTFUL_MARGIN} puntos o menos de un corte (40 / 70);
 *  - un requisito obligatorio «no cumplido» (un descarte que conviene confirmar);
 *  - {@link DOUBTFUL_OPEN_GAP} puntos o más entre el puntaje y el máximo alcanzable.
 */
export function isDoubtful(
  result: Pick<EvaluationResult, "level" | "scores" | "items">,
  requirements: Pick<RequirementInput, "id" | "priority">[],
): boolean {
  if (result.level === "pendiente" || result.level === "parcial") return true;
  const { score, potential } = result.scores;
  if (Math.abs(score - LEVEL_RULES.high) <= DOUBTFUL_MARGIN) return true;
  if (Math.abs(score - LEVEL_RULES.partial) <= DOUBTFUL_MARGIN) return true;
  if (potential - score >= DOUBTFUL_OPEN_GAP) return true;
  const mandatory = new Set(requirements.filter((r) => r.priority === "obligatorio").map((r) => r.id));
  return result.items.some((item) => item.assessment === "no_cumplido" && mandatory.has(item.requirementId));
}
