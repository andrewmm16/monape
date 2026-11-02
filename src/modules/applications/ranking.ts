import type { Enums } from "@/types/database";

/**
 * Orden «mejor opción» para comparar candidatos de una vacante. Es puro y
 * determinista: mismas entradas, mismo orden. Es una ayuda orientativa; la
 * decisión sigue siendo de RRHH.
 */

export const MIN_COMPARED = 2;
export const MAX_COMPARED = 4;

/** Texto breve que se muestra en pantalla bajo el título de la comparación. */
export const RANKING_EXPLANATION =
  "Mejor opción: van al final quienes tienen un requisito obligatorio verificado como «no cumple» y, después, quienes tienen la evaluación desactualizada. " +
  "El resto se ordena por mayor puntuación, mayor peso de requisitos obligatorios acreditados, más requisitos verificados como «cumple», haber pasado la última entrevista y, por último, la postulación más antigua. " +
  "Es una ayuda orientativa: la decisión es de RRHH.";

export type RankInput = {
  id: string;
  /** Puntuación de la evaluación vigente (% del peso acreditado). */
  score: number;
  /** La evaluación usó criterios anteriores a los vigentes. */
  evaluationOutdated: boolean;
  /** Algún requisito OBLIGATORIO tiene un «no cumple» verificado por RRHH. */
  hasVerifiedMandatoryNotMet: boolean;
  /** Suma de pesos de los requisitos obligatorios acreditados. */
  mandatoryMetWeight: number;
  /** Cantidad de requisitos verificados como «cumple». */
  verifiedMetCount: number;
  /** Fecha de la postulación (ISO). */
  appliedAt: string;
  /**
   * Resultado de la entrevista (mayor es mejor): 1 si la última entrevista
   * realizada fue «Pasó» y 0 en otro caso. Desempata después de los requisitos
   * verificados y antes de la antigüedad. Quien no lo informa (null/undefined)
   * queda detrás de quien sí.
   */
  interviewScore?: number | null;
};

/** Hechos de ranking que salen de los ítems de una evaluación. */
export function rankingFacts(
  items: {
    priority: Enums<"requirement_priority">;
    weight: number;
    assessment: Enums<"requirement_assessment">;
    verification_source: Enums<"verification_source"> | null;
  }[],
): Pick<RankInput, "hasVerifiedMandatoryNotMet" | "mandatoryMetWeight" | "verifiedMetCount"> {
  let hasVerifiedMandatoryNotMet = false;
  let mandatoryMetWeight = 0;
  let verifiedMetCount = 0;
  for (const item of items) {
    const verified = item.verification_source !== null;
    if (item.priority === "obligatorio" && item.assessment === "no_cumplido" && verified) hasVerifiedMandatoryNotMet = true;
    if (item.priority === "obligatorio" && item.assessment === "acreditado") mandatoryMetWeight += item.weight;
    if (item.assessment === "acreditado" && verified) verifiedMetCount += 1;
  }
  return { hasVerifiedMandatoryNotMet, mandatoryMetWeight, verifiedMetCount };
}

const desc = (a: number, b: number) => (a === b ? 0 : b > a ? 1 : -1);
const asc = (a: number, b: number) => desc(b, a);
const flag = (a: boolean, b: boolean) => Number(a) - Number(b); // false primero

function compare(a: RankInput, b: RankInput): number {
  return (
    flag(a.hasVerifiedMandatoryNotMet, b.hasVerifiedMandatoryNotMet) ||
    flag(a.evaluationOutdated, b.evaluationOutdated) ||
    desc(a.score, b.score) ||
    desc(a.mandatoryMetWeight, b.mandatoryMetWeight) ||
    desc(a.verifiedMetCount, b.verifiedMetCount) ||
    desc(a.interviewScore ?? Number.NEGATIVE_INFINITY, b.interviewScore ?? Number.NEGATIVE_INFINITY) ||
    asc(Date.parse(a.appliedAt), Date.parse(b.appliedAt)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Ordena de la mejor a la peor opción. No modifica la entrada. */
export function rankCandidates<T extends RankInput>(candidates: readonly T[]): T[] {
  return [...candidates].sort(compare);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompareIdsResult = { ok: true; ids: string[] } | { ok: false; error: string };

/** Valida `?ids=a,b,c` (también acepta el parámetro repetido): de 2 a 4 uuid distintos. */
export function parseCompareIds(raw: string | string[] | undefined): CompareIdsResult {
  const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) {
    return { ok: false, error: `Elija de ${MIN_COMPARED} a ${MAX_COMPARED} candidatos para compararlos.` };
  }
  if (values.some((value) => !UUID.test(value))) {
    return { ok: false, error: "El enlace de la comparación no es válido: hay un identificador incorrecto." };
  }
  const ids = [...new Set(values.map((value) => value.toLowerCase()))];
  if (ids.length < MIN_COMPARED) {
    return { ok: false, error: `Elija al menos ${MIN_COMPARED} candidatos distintos para compararlos.` };
  }
  if (ids.length > MAX_COMPARED) {
    return { ok: false, error: `Solo se pueden comparar hasta ${MAX_COMPARED} candidatos a la vez.` };
  }
  return { ok: true, ids };
}
