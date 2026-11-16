import type { Enums } from "@/types/database";

/**
 * Rúbrica global de la evaluación colaborativa. Las competencias viven en el
 * código (iguales para todas las vacantes); se pueden ampliar después. Cambiar
 * una `key` existente rompería la lectura de tarjetas antiguas: solo agregar.
 */
export const SCORECARD_COMPETENCIES = [
  { key: "tecnica", label: "Competencia técnica" },
  { key: "comunicacion", label: "Comunicación" },
  { key: "resolucion", label: "Resolución de problemas" },
  { key: "experiencia", label: "Experiencia relevante" },
  { key: "fit", label: "Fit cultural / actitud" },
] as const;

export type CompetencyKey = (typeof SCORECARD_COMPETENCIES)[number]["key"];

export const COMPETENCY_KEYS = SCORECARD_COMPETENCIES.map((c) => c.key) as [CompetencyKey, ...CompetencyKey[]];

export const COMPETENCY_LABELS: Record<CompetencyKey, string> = Object.fromEntries(
  SCORECARD_COMPETENCIES.map((c) => [c.key, c.label]),
) as Record<CompetencyKey, string>;

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** Diferencia de puntaje en una competencia a partir de la cual se marca «desacuerdo». */
export const DISAGREEMENT_THRESHOLD = 2;

export const SCORECARD_RECOMMENDATIONS: { key: Enums<"scorecard_recommendation">; label: string }[] = [
  { key: "avanza", label: "Avanza" },
  { key: "duda", label: "Dudo" },
  { key: "no_avanza", label: "No avanza" },
];

export const RECOMMENDATION_LABELS: Record<Enums<"scorecard_recommendation">, string> = {
  avanza: "Avanza",
  duda: "Dudo",
  no_avanza: "No avanza",
};
