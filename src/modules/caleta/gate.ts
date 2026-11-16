import type { Assessment, EvaluationResult, RequirementInput } from "@/modules/evaluation/types";

/**
 * Filtro de afinidad del Reclutador Caleta.
 *
 * Decide si un prospecto recién cosechado es "apto" para contactar o debe
 * quedar `descartado`. Es un pre-filtro de sourcing, no la evaluación formal:
 * la verificación documental de RRHH ocurre después, al derivar el prospecto a
 * candidato.
 *
 * Regla (acordada): pasa si **todos** los requisitos indispensables
 * (`isEssential`) tienen evidencia positiva **y** el score de afinidad llega al
 * umbral (por defecto 40 %).
 *
 * Importante sobre los indispensables: el motor de reglas NUNCA marca
 * `acreditado` un requisito esencial —cuando el CV aporta evidencia lo deja en
 * `pendiente_verificacion` porque exige documentos—, así que aquí
 * `pendiente_verificacion` cuenta como evidencia positiva. Un indispensable
 * solo "falta" si está `sin_evidencia` o `no_cumplido` (o no tiene ítem).
 */

/** Umbral de afinidad por defecto (%). Configurable vía CALETA_UMBRAL_AFINIDAD. */
export const UMBRAL_AFINIDAD_DEFECTO = 40;

/** Valoraciones que cuentan como "el CV aparenta cumplir el requisito". */
const EVIDENCIA_POSITIVA: ReadonlySet<Assessment> = new Set<Assessment>([
  "acreditado",
  "pendiente_verificacion",
]);

export type ResultadoGate = {
  /** true si el prospecto es apto para contactar. */
  pasa: boolean;
  /** Score de afinidad (0-100), redondeado como se guarda en la columna `score`. */
  score: number;
  /** Umbral aplicado. */
  umbral: number;
  /** true si todos los indispensables tienen evidencia positiva. */
  cumpleIndispensables: boolean;
  /** Descripción de los indispensables sin evidencia positiva (vacío si cumple). */
  indispensablesFaltantes: string[];
  /** Texto corto, apto para la columna `notes`. */
  motivo: string;
};

/**
 * Puro y determinista: mismas entradas → mismo resultado. No toca la base.
 */
export function evaluarGateAfinidad(
  requirements: RequirementInput[],
  detail: EvaluationResult,
  umbral: number = UMBRAL_AFINIDAD_DEFECTO,
): ResultadoGate {
  const assessmentPorId = new Map(detail.items.map((item) => [item.requirementId, item.assessment]));

  const indispensablesFaltantes = requirements
    .filter((r) => r.isEssential)
    .filter((r) => {
      const assessment = assessmentPorId.get(r.id);
      return assessment === undefined || !EVIDENCIA_POSITIVA.has(assessment);
    })
    .map((r) => r.description);

  const score = Math.round(detail.scores.score);
  const cumpleIndispensables = indispensablesFaltantes.length === 0;
  const cumpleUmbral = score >= umbral;
  const pasa = cumpleIndispensables && cumpleUmbral;

  let motivo: string;
  if (pasa) {
    motivo = `Apto: afinidad ${score}% (≥${umbral}%) y todos los indispensables con evidencia.`;
  } else if (!cumpleIndispensables) {
    motivo = `Descartado por afinidad: falta evidencia de indispensable(s): ${indispensablesFaltantes.join("; ")}.`;
  } else {
    motivo = `Descartado por afinidad: ${score}% < ${umbral}%.`;
  }

  return { pasa, score, umbral, cumpleIndispensables, indispensablesFaltantes, motivo };
}
