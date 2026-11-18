import { createHash } from "node:crypto";
import type { EvaluationResult, ItemAssessment, RequirementInput } from "../types";

/** Por qué una evaluación del motor pide segunda opinión (para medir y explicar, no se persiste). */
export type DoubtReason = "duda_del_motor" | "posible_relleno" | "obligatorio_no_cumplido";

export type DoubtExtras = {
  /** Valoraciones del motor CON sus marcas de duda (`signal`), que el resultado ensamblado no conserva. */
  engineItems?: Pick<ItemAssessment, "signal" | "cvAssessment">[];
  /** El CV tiene el aviso de relleno de palabras clave. */
  suspiciousText?: boolean;
};

/**
 * Motivos para pedir una segunda opinión con IA sobre esta evaluación del motor:
 * solo lo que la IA puede resolver y que puede mover el puntaje.
 *  - una duda concreta del motor en algún requisito no verificado por RRHH (cargo
 *    relacionado, mención dudosa, negación explícita, nivel, fechas, errata…: ver
 *    EngineSignal);
 *  - el CV tiene señales de relleno de palabras clave;
 *  - un requisito obligatorio «no cumplido» (un descarte que conviene confirmar).
 * Hasta el 18/11/2026 también contaban el nivel «pendiente»/«parcial», estar cerca
 * de un corte y tener mucho por confirmar: mandaban el 75 % de los CV del banco a
 * la IA y la IA cambió el puntaje de 1 candidato de 25 (medido con la app real).
 * Lo demás lo cubre la muestra de control (AI_CONTROL_SAMPLE_PERCENT).
 */
export function doubtReasons(
  result: Pick<EvaluationResult, "level" | "scores" | "items">,
  requirements: Pick<RequirementInput, "id" | "priority">[],
  extras: DoubtExtras = {},
): DoubtReason[] {
  const reasons: DoubtReason[] = [];
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
