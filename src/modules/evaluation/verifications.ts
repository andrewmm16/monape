import { formatNumericDate } from "@/lib/format";
import { VERIFICATION_SOURCE_PHRASES } from "@/lib/labels";
import type { Enums } from "@/types/database";
import type { ItemAssessment } from "./types";

/** Longitud máxima de `rationale` (también la verifica la base de datos). */
const RATIONALE_MAX_LENGTH = 2000;

/** Verificación vigente de un requisito, con el nombre de quien la registró. */
export type RequirementVerification = {
  requirementId: string;
  result: Extract<Enums<"requirement_assessment">, "acreditado" | "no_cumplido">;
  source: Enums<"verification_source">;
  note: string;
  verifiedAt: string;
  verifiedByName: string | null;
};

/** «Verificado en entrevista el 28/10/2026 por Luis: nota. Según el CV: motivo original». */
export function buildVerifiedRationale(verification: RequirementVerification, cvRationale: string): string {
  const who = verification.verifiedByName ? ` por ${verification.verifiedByName}` : "";
  const cv = cvRationale.trim();
  const text =
    `Verificado en ${VERIFICATION_SOURCE_PHRASES[verification.source]} el ${formatNumericDate(verification.verifiedAt)}${who}: ` +
    `${verification.note.trim()}.${cv ? ` Según el CV: ${cv}` : ""}`;
  return text.length <= RATIONALE_MAX_LENGTH ? text : `${text.slice(0, RATIONALE_MAX_LENGTH - 1)}…`;
}

/**
 * Aplica las verificaciones de RRHH a las valoraciones del CV (o del motor):
 * la valoración pasa a ser el resultado verificado, lo que dio el CV se
 * conserva en `cvAssessment` y su evidencia no se toca. Es pura; los requisitos
 * sin verificación quedan igual.
 */
export function applyVerifications(items: ItemAssessment[], verifications: RequirementVerification[]): ItemAssessment[] {
  const byRequirement = new Map(verifications.map((v) => [v.requirementId, v]));
  return items.map((item) => {
    const verification = byRequirement.get(item.requirementId);
    if (!verification) return item;
    return {
      ...item,
      assessment: verification.result,
      cvAssessment: item.assessment,
      cvRationale: item.rationale,
      rationale: buildVerifiedRationale(verification, item.rationale),
    };
  });
}

/** Ítem de una evaluación ya registrada, con lo necesario para reconstruirla. */
export type StoredEvaluationItem = {
  requirementId: string;
  assessment: ItemAssessment["assessment"];
  /** Valoración original del CV; nula si el ítem no estaba verificado. */
  cvAssessment: ItemAssessment["assessment"] | null;
  rationale: string;
  /** Motivo original del CV; nulo si el ítem no estaba verificado (o es anterior a esta columna). */
  cvRationale: string | null;
  evidence: ItemAssessment["evidence"];
};

const CV_RATIONALE_MARK = "Según el CV: ";

/**
 * Motivo original de un ítem. Las evaluaciones verificadas antes de existir
 * `cv_rationale` lo llevan al final del texto («… Según el CV: motivo»).
 */
function originalRationale(item: StoredEvaluationItem): string {
  if (!item.cvAssessment) return item.rationale;
  if (item.cvRationale !== null) return item.cvRationale;
  const at = item.rationale.lastIndexOf(CV_RATIONALE_MARK);
  return at === -1 ? "" : item.rationale.slice(at + CV_RATIONALE_MARK.length);
}

/**
 * Valoraciones tal como las dio el CV (o el motor): deshace las verificaciones
 * de una evaluación registrada. La base es `cvAssessment ?? assessment` y el
 * motivo original, con su evidencia.
 */
export function restoreCvItems(stored: StoredEvaluationItem[]): ItemAssessment[] {
  return stored.map((item) => ({
    requirementId: item.requirementId,
    assessment: item.cvAssessment ?? item.assessment,
    evidence: item.evidence,
    rationale: originalRationale(item),
  }));
}

/** Reconstruye los ítems de una evaluación con las verificaciones actuales (agregadas o quitadas). */
export function rebuildItems(stored: StoredEvaluationItem[], verifications: RequirementVerification[]): ItemAssessment[] {
  return applyVerifications(restoreCvItems(stored), verifications);
}
