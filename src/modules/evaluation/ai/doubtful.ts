import { createHash } from "node:crypto";
import { LEVEL_RULES } from "../scoring";
import type { EvaluationResult, ItemAssessment, RequirementInput } from "../types";

/** Distancia (en puntos) a un corte de nivel dentro de la cual el resultado se considera frontera. */
export const DOUBTFUL_MARGIN = 10;
/** Diferencia entre el máximo alcanzable y el puntaje a partir de la cual queda mucho por confirmar. */
export const DOUBTFUL_OPEN_GAP = 30;

/** Por qué una evaluación del motor pide segunda opinión (para medir y explicar, no se persiste). */
export type DoubtReason =
  | "nivel_intermedio"
  | "cerca_de_corte"
  | "mucho_por_confirmar"
  | "obligatorio_no_cumplido"
  | "duda_del_motor"
  | "posible_relleno";

export type DoubtExtras = {
  /** Valoraciones del motor CON sus marcas de duda (`signal`), que el resultado ensamblado no conserva. */
  engineItems?: Pick<ItemAssessment, "signal" | "cvAssessment">[];
  /** El CV tiene el aviso de relleno de palabras clave. */
  suspiciousText?: boolean;
};

/**
 * Motivos para pedir una segunda opinión con IA sobre esta evaluación del motor.
 * Es donde se concentran sus falsos positivos y negativos:
 *  - nivel «pendiente» o «parcial» (falta evidencia o el resultado es intermedio);
 *  - puntaje a {@link DOUBTFUL_MARGIN} puntos o menos de un corte (40 / 70);
 *  - {@link DOUBTFUL_OPEN_GAP} puntos o más entre el puntaje y el máximo alcanzable;
 *  - un requisito obligatorio «no cumplido» (un descarte que conviene confirmar);
 *  - una duda concreta del motor en algún requisito no verificado por RRHH (cargo
 *    relacionado, mención dudosa, nivel, fechas, errata…: ver EngineSignal);
 *  - el CV tiene señales de relleno de palabras clave.
 */
export function doubtReasons(
  result: Pick<EvaluationResult, "level" | "scores" | "items">,
  requirements: Pick<RequirementInput, "id" | "priority">[],
  extras: DoubtExtras = {},
): DoubtReason[] {
  const reasons: DoubtReason[] = [];
  if (result.level === "pendiente" || result.level === "parcial") reasons.push("nivel_intermedio");
  const { score, potential } = result.scores;
  if (Math.abs(score - LEVEL_RULES.high) <= DOUBTFUL_MARGIN || Math.abs(score - LEVEL_RULES.partial) <= DOUBTFUL_MARGIN) {
    reasons.push("cerca_de_corte");
  }
  if (potential - score >= DOUBTFUL_OPEN_GAP) reasons.push("mucho_por_confirmar");
  const mandatory = new Set(requirements.filter((r) => r.priority === "obligatorio").map((r) => r.id));
  if (result.items.some((item) => item.assessment === "no_cumplido" && mandatory.has(item.requirementId))) {
    reasons.push("obligatorio_no_cumplido");
  }
  if (extras.engineItems?.some((item) => item.signal && !item.cvAssessment)) reasons.push("duda_del_motor");
  if (extras.suspiciousText) reasons.push("posible_relleno");
  return reasons;
}

/** ¿Conviene una segunda opinión con IA sobre esta evaluación del motor? Ver {@link doubtReasons}. */
export function isDoubtful(
  result: Pick<EvaluationResult, "level" | "scores" | "items">,
  requirements: Pick<RequirementInput, "id" | "priority">[],
  extras: DoubtExtras = {},
): boolean {
  return doubtReasons(result, requirements, extras).length > 0;
}

/**
 * Muestra de control: un porcentaje de las evaluaciones SIN dudas también va a la
 * IA, para descubrir los errores que el motor comete sin saberlo. Determinista por
 * postulación (la misma postulación siempre cae del mismo lado), así se puede
 * reproducir y probar.
 */
export function inControlSample(applicationId: string, percent: number): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const bucket = createHash("sha256").update(applicationId).digest().readUInt32BE(0) / 0x1_0000_0000;
  return bucket * 100 < percent;
}
