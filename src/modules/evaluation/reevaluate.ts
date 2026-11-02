import "server-only";
import { AppError, logServerError, toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { assembleEvaluation } from "./assemble";
import {
  CRITERIA_NOT_APPROVED_MESSAGE,
  evaluateApplication,
  listVerifications,
  recordAssembledEvaluation,
  ResumeTextUnavailableError,
} from "./service";
import type { Evidence, RequirementInput } from "./types";
import { rebuildItems, type StoredEvaluationItem } from "./verifications";

export type ReevaluationOutcome = { reevaluated: boolean; notice: string | null };

const NOT_RESPECTED = /verificaciones/i;

/**
 * Reconstruye la evaluación vigente con las verificaciones actuales, sin leer
 * el CV ni llamar a la IA: parte de los ítems registrados (valoración y motivo
 * originales), aplica las verificaciones, recalcula la puntuación y registra una
 * evaluación nueva con el mismo método, versión, modelo, CV y huella.
 * Devuelve false si no se puede (sin evaluación vigente, criterios
 * desactualizados o ítems que ya no coinciden con los requisitos).
 */
async function rebuildCurrentEvaluation(supabase: AppSupabaseClient, applicationId: string): Promise<boolean> {
  const { data: application, error } = await supabase
    .from("applications")
    .select("id, latest_evaluation_id, vacancies(id, criteria_version, criteria_approved_at)")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw toAppError(error);
  const vacancy = application?.vacancies;
  if (!application || !vacancy || !application.latest_evaluation_id) return false;
  if (!vacancy.criteria_approved_at) throw new AppError(CRITERIA_NOT_APPROVED_MESSAGE, "conflict");

  const { data: evaluation, error: evaluationError } = await supabase
    .from("candidate_evaluations")
    .select("id, resume_id, criteria_version, method, method_version, model, input_sha256, limitations")
    .eq("id", application.latest_evaluation_id)
    .maybeSingle();
  if (evaluationError) throw toAppError(evaluationError);
  if (!evaluation || evaluation.criteria_version !== vacancy.criteria_version) return false;

  const [{ data: requirementRows, error: requirementsError }, { data: itemRows, error: itemsError }] = await Promise.all([
    supabase
      .from("vacancy_requirements")
      .select("id, category, priority, description, keywords, weight, min_years, is_essential")
      .eq("vacancy_id", vacancy.id)
      .order("position")
      .order("created_at"),
    supabase
      .from("candidate_evaluation_items")
      .select("requirement_id, assessment, cv_assessment, rationale, cv_rationale, evidence")
      .eq("evaluation_id", evaluation.id),
  ]);
  if (requirementsError) throw toAppError(requirementsError);
  if (itemsError) throw toAppError(itemsError);

  const requirements: RequirementInput[] = requirementRows.map((r) => ({
    id: r.id,
    category: r.category,
    priority: r.priority,
    description: r.description,
    keywords: r.keywords,
    weight: r.weight,
    minYears: r.min_years,
    isEssential: r.is_essential,
  }));
  const stored: StoredEvaluationItem[] = itemRows.flatMap((row) =>
    row.requirement_id
      ? [
          {
            requirementId: row.requirement_id,
            assessment: row.assessment,
            cvAssessment: row.cv_assessment,
            rationale: row.rationale,
            cvRationale: row.cv_rationale,
            evidence: (Array.isArray(row.evidence) ? row.evidence : []) as Evidence[],
          },
        ]
      : [],
  );
  const known = new Set(requirements.map((r) => r.id));
  if (requirements.length === 0 || stored.length !== requirements.length || !stored.every((item) => known.has(item.requirementId))) {
    return false;
  }

  const result = assembleEvaluation({
    method: evaluation.method,
    methodVersion: evaluation.method_version,
    model: evaluation.model,
    requirements,
    items: rebuildItems(stored, await listVerifications(supabase, application.id)),
    textWasCorrected: evaluation.limitations.some((text) => text.startsWith("Se evaluó el texto del CV corregido")),
    textTruncated: evaluation.limitations.some((text) => text.startsWith("El CV es extenso")),
  });
  await recordAssembledEvaluation(supabase, {
    applicationId: application.id,
    resumeId: evaluation.resume_id,
    criteriaVersion: vacancy.criteria_version,
    result,
    inputSha256: evaluation.input_sha256,
  });
  return true;
}

/**
 * Actualiza la puntuación después de cambiar una verificación. No consume el
 * límite `evaluation`.
 * - Con evaluación vigente y criterios vigentes: la reconstruye (mismo método,
 *   motivos originales de lo no verificado); no lee el CV ni usa la IA. Si una
 *   verificación concurrente hace que el registro la rechace, relee y reintenta una vez.
 * - Sin evaluación vigente o con criterios desactualizados: evaluación con reglas.
 * Si no es posible, la verificación ya quedó guardada.
 */
export async function reevaluateAfterVerification(
  supabase: AppSupabaseClient,
  applicationId: string,
): Promise<ReevaluationOutcome> {
  try {
    let rebuilt: boolean;
    try {
      rebuilt = await rebuildCurrentEvaluation(supabase, applicationId);
    } catch (error) {
      if (!(error instanceof AppError && error.code === "validation" && NOT_RESPECTED.test(error.message))) throw error;
      rebuilt = await rebuildCurrentEvaluation(supabase, applicationId);
    }
    if (!rebuilt) await evaluateApplication(supabase, applicationId, "reglas");
    return { reevaluated: true, notice: null };
  } catch (error) {
    logServerError("evaluations.verify", error);
    if (error instanceof ResumeTextUnavailableError) {
      return {
        reevaluated: false,
        notice: `${error.message} La puntuación se actualizará cuando haya texto evaluable del CV.`,
      };
    }
    if (error instanceof AppError && error.message === CRITERIA_NOT_APPROVED_MESSAGE) {
      return { reevaluated: false, notice: "Los criterios de la vacante no están aprobados; se aplicará en la próxima evaluación." };
    }
    return { reevaluated: false, notice: "No se pudo recalcular la evaluación; genérela de nuevo para aplicarla." };
  }
}
