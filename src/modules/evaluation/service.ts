import "server-only";
import { createHash } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { AppError, toAppError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import { assembleEvaluation } from "./assemble";
import { requestAnthropicAssessment } from "./ai/anthropic";
import { getAiAvailability } from "./ai/availability";
import { buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from "./ai/prompt";
import { redactContactData } from "./ai/redact";
import { interpretAiResponse, InvalidAiResponseError } from "./ai/response";
import { evaluateWithRules, RULE_ENGINE_VERSION } from "./rule-engine";
import type { EvaluationMethod, ItemAssessment, RequirementInput } from "./types";

const MIN_TEXT_LENGTH = 50;

export const CRITERIA_NOT_APPROVED_MESSAGE = "Los criterios de la vacante deben estar aprobados por RRHH antes de evaluar.";

/**
 * La postulación no se puede evaluar porque no hay CV o no hay texto legible
 * (p. ej. un escaneado). Permite distinguirla de otros fallos sin comparar textos.
 */
export class ResumeTextUnavailableError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "ResumeTextUnavailableError";
  }
}

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
  const { data: application, error } = await supabase
    .from("applications")
    .select("id, candidate_id, resume_id, vacancies(id, title, criteria_version, criteria_approved_at)")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!application?.vacancies) throw new AppError("La postulación no existe o no tiene acceso.", "not_found");

  const vacancy = application.vacancies;
  if (!vacancy.criteria_approved_at) {
    throw new AppError(CRITERIA_NOT_APPROVED_MESSAGE, "conflict");
  }

  const { data: requirementRows, error: requirementsError } = await supabase
    .from("vacancy_requirements")
    .select("id, category, priority, description, keywords, weight, min_years, is_essential")
    .eq("vacancy_id", vacancy.id)
    .order("position")
    .order("created_at");
  if (requirementsError) throw toAppError(requirementsError);
  if (!requirementRows?.length) throw new AppError("La vacante no tiene requisitos definidos.", "conflict");

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

  // Se evalúa el CV asociado a la postulación (o el vigente si aún no tiene
  // uno): una carga posterior no cambia lo evaluado sin decisión de RRHH.
  let resumeQuery = supabase
    .from("resumes")
    .select("id, resume_extractions(raw_text, corrected_text)")
    .eq("candidate_id", application.candidate_id);
  resumeQuery = application.resume_id ? resumeQuery.eq("id", application.resume_id) : resumeQuery.eq("is_current", true);
  const { data: resume, error: resumeError } = await resumeQuery.maybeSingle();
  if (resumeError) throw toAppError(resumeError);
  if (!resume) throw new ResumeTextUnavailableError("El candidato no tiene un CV cargado.");

  const extraction = resume.resume_extractions;
  const textWasCorrected = Boolean(extraction?.corrected_text);
  const fullText = (extraction?.corrected_text ?? extraction?.raw_text ?? "").trim();
  if (fullText.length < MIN_TEXT_LENGTH) {
    throw new ResumeTextUnavailableError(
      "No hay texto legible del CV. Revise la extracción o transcriba el contenido en la ficha del candidato.",
    );
  }

  let items: ItemAssessment[];
  let methodVersion: string;
  let model: string | null = null;
  let textTruncated = false;
  let evaluatedText = fullText;

  if (method === "reglas") {
    items = evaluateWithRules(fullText, requirements, { referenceDate: new Date() });
    methodVersion = RULE_ENGINE_VERSION;
  } else {
    const env = getServerEnv();
    const availability = getAiAvailability(env);
    if (!availability.available) throw new AppError(availability.reason, "unavailable");
    if ((await countAiEvaluationsLast24h(supabase)) >= env.AI_MAX_EVALUATIONS_PER_DAY) {
      throw new AppError("Se alcanzó el límite diario de evaluaciones con IA.", "rate_limited");
    }

    // Minimización: no se envían datos de contacto ni el nombre del archivo.
    evaluatedText = redactContactData(fullText);
    if (evaluatedText.length > env.AI_MAX_INPUT_CHARS) {
      evaluatedText = evaluatedText.slice(0, env.AI_MAX_INPUT_CHARS);
      textTruncated = true;
    }

    const response = await requestAnthropicAssessment({
      apiKey: env.AI_API_KEY!,
      model: availability.model,
      system: SYSTEM_PROMPT,
      userMessage: buildUserMessage({ vacancyTitle: vacancy.title, requirements, resumeText: evaluatedText }),
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

  const result = assembleEvaluation({
    method,
    methodVersion,
    model,
    requirements,
    items,
    textWasCorrected,
    textTruncated,
  });

  const recordArgs = {
    p_application_id: application.id,
    p_resume_id: resume.id,
    p_criteria_version: vacancy.criteria_version,
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
    p_input_sha256: createHash("sha256").update(evaluatedText).digest("hex"),
    p_items: result.items.map((item) => ({
      requirement_id: item.requirementId,
      assessment: item.assessment,
      evidence: item.evidence,
      rationale: item.rationale,
    })) as Json,
  };
  const { data: evaluationId, error: recordError } = options.system
    ? await supabase.rpc("record_system_evaluation", recordArgs)
    : await supabase.rpc("record_evaluation", recordArgs);
  if (recordError) throw toAppError(recordError);
  if (!evaluationId) throw new AppError("No se pudo registrar la evaluación.", "internal");
  return evaluationId;
}
