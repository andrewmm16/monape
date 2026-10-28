import type { Assessment, CompatibilityLevel, ItemAssessment, RequirementInput, Scores } from "./types";

/**
 * Metodología de puntuación v1 (documentada en docs/metodologia-evaluacion.md).
 * La base de datos recalcula los mismos porcentajes al registrar una
 * evaluación y rechaza cualquier discrepancia (función record_evaluation).
 */
export const SCORING_VERSION = "v1";

export const LEVEL_RULES = {
  /** % de peso acreditado a partir del cual la compatibilidad es alta. */
  high: 70,
  /** % de peso acreditado a partir del cual la compatibilidad es parcial. */
  partial: 40,
  /** Si más de este % del peso no tiene evidencia, la evaluación queda pendiente. */
  maxUnknown: 50,
} as const;

function percent(part: number, total: number): number {
  return Math.round((part * 10_000) / total) / 100;
}

export function computeScores(items: { weight: number; assessment: Assessment }[]): Scores {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (items.length === 0 || total <= 0) {
    throw new Error("No hay requisitos ponderados para calcular la puntuación");
  }
  const weightOf = (predicate: (a: Assessment) => boolean) =>
    items.filter((item) => predicate(item.assessment)).reduce((sum, item) => sum + item.weight, 0);

  return {
    score: percent(weightOf((a) => a === "acreditado"), total),
    potential: percent(weightOf((a) => a !== "no_cumplido"), total),
    coverage: percent(weightOf((a) => a === "acreditado" || a === "no_cumplido"), total),
    unknown: percent(weightOf((a) => a === "sin_evidencia" || a === "pendiente_verificacion"), total),
    notMet: percent(weightOf((a) => a === "no_cumplido"), total),
  };
}

/**
 * Nivel orientativo de compatibilidad:
 *  1. Si más de la mitad del peso carece de evidencia → "pendiente" (falta
 *     información; no se interpreta como falta de capacidad).
 *  2. ≥ 70 % acreditado y ningún obligatorio aparentemente no cumplido → "alta".
 *  3. ≥ 40 % acreditado → "parcial".
 *  4. En otro caso → "baja" (implica requisitos aparentemente no cumplidos).
 */
export function determineLevel(
  scores: Scores,
  items: { priority: RequirementInput["priority"]; assessment: Assessment }[],
): CompatibilityLevel {
  if (scores.unknown > LEVEL_RULES.maxUnknown) return "pendiente";
  const mandatoryNotMet = items.some((i) => i.priority === "obligatorio" && i.assessment === "no_cumplido");
  if (scores.score >= LEVEL_RULES.high && !mandatoryNotMet) return "alta";
  if (scores.score >= LEVEL_RULES.partial) return "parcial";
  return "baja";
}

const COUNT_LABELS: [Assessment, string, string][] = [
  ["acreditado", "acreditado", "acreditados"],
  ["no_cumplido", "aparentemente no cumplido", "aparentemente no cumplidos"],
  ["sin_evidencia", "sin evidencia", "sin evidencia"],
  ["pendiente_verificacion", "pendiente de verificación", "pendientes de verificación"],
];

export function buildSummary(items: ItemAssessment[], scores: Scores, levelLabel: string): string {
  const parts = COUNT_LABELS.map(([assessment, singular, plural]) => {
    const count = items.filter((i) => i.assessment === assessment).length;
    return count > 0 ? `${count} ${count === 1 ? singular : plural}` : null;
  }).filter(Boolean);
  return (
    `${levelLabel}. De ${items.length} requisitos: ${parts.join(", ")}. ` +
    `Peso acreditado: ${scores.score.toFixed(0)} %; ` +
    `máximo alcanzable si se confirman los requisitos sin evidencia o pendientes: ${scores.potential.toFixed(0)} %.`
  );
}

export function buildLimitations(options: {
  method: "reglas" | "ia";
  scores: Scores;
  items: (ItemAssessment & { isEssential: boolean })[];
  textWasCorrected: boolean;
  textTruncated: boolean;
}): string[] {
  const limitations = [
    "La puntuación es orientativa: no es una probabilidad de contratación ni una medida del valor de la persona. La decisión corresponde a RRHH.",
  ];
  if (options.method === "reglas") {
    limitations.push(
      "El motor de reglas solo detecta menciones explícitas de los términos configurados en cada requisito; no interpreta sinónimos no configurados, nivel de dominio ni contexto.",
    );
  } else {
    limitations.push(
      "La valoración fue propuesta por un modelo de IA. Las citas se verificaron contra el texto del CV y las valoraciones sin cita verificable se marcaron como pendientes de verificación. El modelo puede equivocarse.",
    );
  }
  if (options.scores.unknown > 0) {
    limitations.push(
      `El ${options.scores.unknown.toFixed(0)} % del peso corresponde a requisitos sin evidencia o pendientes de verificación: la falta de información en el CV no equivale a falta de capacidad.`,
    );
  }
  if (options.items.some((i) => i.isEssential)) {
    limitations.push("Hay requisitos legales o esenciales que deben verificarse con documentos antes de una decisión.");
  }
  if (options.textWasCorrected) {
    limitations.push("Se evaluó el texto del CV corregido manualmente por RRHH.");
  }
  if (options.textTruncated) {
    limitations.push("El CV es extenso y solo se evaluó la parte inicial del texto.");
  }
  return limitations;
}
