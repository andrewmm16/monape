import "server-only";
import { createHash } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { AppError, toAppError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import { autoEnqueueAfterRules } from "./ai-queue";
import { assembleEvaluation } from "./assemble";
import { loadEvaluationContext } from "./context";
import { detectDateSignalNotes } from "./date-consistency";
import { requestAnthropicAssessment } from "./ai/anthropic";
import { getAiAvailability } from "./ai/availability";
import { buildAiInput } from "./ai/input";
import { PROMPT_VERSION } from "./ai/prompt";
import { interpretAiResponse, InvalidAiResponseError } from "./ai/response";
import { evaluateWithRules, RULE_ENGINE_VERSION } from "./rule-engine";
import type { EvaluationMethod, EvaluationResult, ItemAssessment } from "./types";
import { applyVerifications, type RequirementVerification } from "./verifications";

export { CRITERIA_NOT_APPROVED_MESSAGE, ResumeTextUnavailableError } from "./context";

export function getAiStatus() {
  return getAiAvailability(getServerEnv());
}

async function countAiEvaluationsLast24h(supabase: AppSupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("candidate_evaluations")
    .select("id", { count: "exact", head: true })
    .eq("method", "ia")
    .gte("created_at", since);
  if (error) throw toAppError(error);
  return count ?? 0;
}

/** Verificaciones vigentes de la postulación, con el nombre de quien las registró. */
export async function listVerifications(
  supabase: AppSupabaseClient | SupabaseClient<Database>,
  applicationId: string,
): Promise<RequirementVerification[]> {
  const { data, error } = await supabase
    .from("requirement_verifications")
    .select("requirement_id, result, source, note, verified_at, verifier:profiles!requirement_verifications_verified_by_fkey(full_name)")
    .eq("application_id", applicationId);
  if (error) throw toAppError(error);
  return (data ?? []).flatMap((row) =>
    row.result === "acreditado" || row.result === "no_cumplido"
      ? [
          {
            requirementId: row.requirement_id,
            result: row.result,
            source: row.source,
            note: row.note,
            verifiedAt: row.verified_at,
            verifiedByName: row.verifier?.full_name ?? null,
          },
        ]
      : [],
  );
}

/**
 * Evalúa una postulación frente a los criterios aprobados de su vacante y
 * registra el resultado. No modifica el estado del proceso de selección.
 *
 * Con `system: true` (integraciones, sin usuario) hay que pasar el cliente de
 * administración: se registra con record_system_evaluation (actor nulo) y solo
 * se admite el motor de reglas, que no envía datos a servicios externos.
 */
export async function evaluateApplication(
  supabase: AppSupabaseClient | SupabaseClient<Database>,
  applicationId: string,
  method: EvaluationMethod,
  options: { system?: boolean } = {},
): Promise<string> {
  if (options.system && method !== "reglas") {
    throw new AppError("La evaluación del sistema solo usa el motor de reglas.", "validation");
  }
  const context = await loadEvaluationContext(supabase, applicationId);
  const { requirements, fullText, textWasCorrected } = context;

  const referenceDate = new Date();
  // Señales deterministas sobre las fechas del CV, independientes del método:
  // solapamientos e incoherencias (notas para verificar en entrevista, no descartan).
  const signalNotes = detectDateSignalNotes(fullText, referenceDate);

  let items: ItemAssessment[];
  let methodVersion: string;
  let model: string | null = null;
  let textTruncated = false;
  let evaluatedText = fullText;

  if (method === "reglas") {
    items = evaluateWithRules(fullText, requirements, { referenceDate });
    methodVersion = RULE_ENGINE_VERSION;
  } else {
    const env = getServerEnv();
    const availability = getAiAvailability(env);
    if (!availability.available) throw new AppError(availability.reason, "unavailable");
    // Con la cola (suscripción vía ia-worker/) la evaluación no corre dentro de la solicitud.
    if (availability.queued) {
      throw new AppError("La evaluación con IA se procesa en cola: solicítela con «Evaluar con IA».", "conflict");
    }
    if ((await countAiEvaluationsLast24h(supabase)) >= env.AI_MAX_EVALUATIONS_PER_DAY) {
      throw new AppError("Se alcanzó el límite diario de evaluaciones con IA.", "rate_limited");
    }

    const input = buildAiInput({
      vacancyTitle: context.vacancyTitle,
      requirements,
      fullText,
      maxChars: env.AI_MAX_INPUT_CHARS,
    });
    evaluatedText = input.evaluatedText;
    textTruncated = input.textTruncated;

    const response = await requestAnthropicAssessment({
      apiKey: env.AI_API_KEY!,
      model: availability.model,
      system: input.system,
      userMessage: input.userMessage,
    });
    try {
      items = interpretAiResponse(response.raw, requirements, evaluatedText);
    } catch (interpretError) {
      if (interpretError instanceof InvalidAiResponseError) {
        throw new AppError("La respuesta del modelo no fue válida y se descartó. No se registró ninguna evaluación.", "unavailable");
      }
      throw interpretError;
    }
    methodVersion = PROMPT_VERSION;
    model = response.model;
  }

  // Lo que RRHH comprobó después del CV prevalece, sin perder la valoración original.
  items = applyVerifications(items, await listVerifications(supabase, context.applicationId));

  const result = assembleEvaluation({
    method,
    methodVersion,
    model,
    requirements,
    items,
    textWasCorrected,
    textTruncated,
    signalNotes,
  });

  const evaluationId = await recordAssembledEvaluation(supabase, {
    applicationId: context.applicationId,
    resumeId: context.resumeId,
    criteriaVersion: context.criteriaVersion,
    result,
    inputSha256: createHash("sha256").update(evaluatedText).digest("hex"),
    system: options.system,
  });

  // Segunda opinión con IA en cola (según AI_AUTO_ENQUEUE). Nunca hace fallar al motor.
  if (method === "reglas") {
    await autoEnqueueAfterRules(supabase, {
      applicationId: context.applicationId,
      result,
      requirements,
      system: options.system,
    });
  }

  return evaluationId;
}

/** Registra una evaluación ya armada (con record_evaluation, o record_system_evaluation si es del sistema). */
export async function recordAssembledEvaluation(
  supabase: AppSupabaseClient | SupabaseClient<Database>,
  input: {
    applicationId: string;
    resumeId: string | null;
    criteriaVersion: number;
    result: EvaluationResult;
    inputSha256: string | null;
    system?: boolean;
  },
): Promise<string> {
  const { result } = input;
  const recordArgs = {
    p_application_id: input.applicationId,
    p_resume_id: input.resumeId,
    p_criteria_version: input.criteriaVersion,
    p_method: result.method,
    p_method_version: result.methodVersion,
    p_scoring_version: result.scoringVersion,
    p_model: result.model,
    p_score: result.scores.score,
    p_score_potential: result.scores.potential,
    p_evidence_coverage: result.scores.coverage,
    p_level: result.level,
    p_summary: result.summary,
    p_limitations: result.limitations,
    p_input_sha256: input.inputSha256,
    p_items: result.items.map((item) => ({
      requirement_id: item.requirementId,
      assessment: item.assessment,
      evidence: item.evidence,
      rationale: item.rationale,
      ...(item.cvAssessment ? { cv_assessment: item.cvAssessment } : {}),
      ...(item.cvRationale ? { cv_rationale: item.cvRationale } : {}),
    })) as Json,
  };
  const { data: evaluationId, error: recordError } = input.system
    ? await supabase.rpc("record_system_evaluation", recordArgs)
    : await supabase.rpc("record_evaluation", recordArgs);
  if (recordError) throw toAppError(recordError);
  if (!evaluationId) throw new AppError("No se pudo registrar la evaluación.", "internal");
  return evaluationId;
}
