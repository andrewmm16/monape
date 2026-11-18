import type { Assessment, ItemAssessment } from "../types";
import { hasEngineDoubt } from "./engine-notes";

/**
 * «El motor decide; en lo que duda, releva la IA»: la misma política que mide
 * `npm run medir:ia` (columna «Motor+IA»). Donde el motor tuvo una duda (por
 * confirmar, sin evidencia o una marca de duda) y la IA dice «cumple» o «no
 * cumple», cuenta la IA; en lo demás, el motor. Lo resuelto por una regla
 * aprendida no se toca.
 * Pura: las verificaciones de RRHH se aplican después y siempre prevalecen.
 */

const ENGINE_LABELS: Record<Assessment, string> = {
  acreditado: "acreditado",
  no_cumplido: "no cumplido",
  pendiente_verificacion: "por confirmar",
  sin_evidencia: "sin evidencia",
};

export function relayToAi(engineItems: ItemAssessment[], aiItems: ItemAssessment[]): ItemAssessment[] {
  const ai = new Map(aiItems.map((item) => [item.requirementId, item]));
  return engineItems.map((item) => {
    const second = ai.get(item.requirementId);
    if (!second || item.resolvedBy || !hasEngineDoubt(item)) return item;
    // La valoración original de la IA (si RRHH ya verificó algo, se vuelve a aplicar después).
    const assessment = second.cvAssessment ?? second.assessment;
    // Solo cuenta si cambia el puntaje: «cumple» o «no cumple». Un «por confirmar» de la IA
    // donde el motor no vio nada es un indicio (se muestra como nota de la segunda opinión),
    // no reemplaza la etiqueta del motor (medido el 18/11: 11 de 16 cambios eran solo eso).
    if (assessment !== "acreditado" && assessment !== "no_cumplido") return item;
    const rationale = second.cvRationale ?? second.rationale;
    return {
      requirementId: item.requirementId,
      assessment,
      evidence: second.evidence,
      rationale: `Resuelto por la IA (el motor lo dejó ${ENGINE_LABELS[item.assessment]}): ${rationale}`,
      resolvedBy: "ia",
      engineAssessment: item.assessment,
    };
  });
}

/** ¿La IA resolvió alguna duda del motor? */
export function hasRelayedItems(items: ItemAssessment[]): boolean {
  return items.some((item) => item.resolvedBy === "ia");
}
