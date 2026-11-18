import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { buildInterviewGuide, type GuideItemInput, type GuideQuestion } from "./interview-guide";
import { toEngineSignal, type Evidence } from "./types";

/**
 * Guía de entrevista de una postulación, a partir de su evaluación vigente (la del
 * motor, con lo que relevó la IA) y de la segunda opinión de la IA del mismo CV y
 * criterios (su pregunta y su motivo). Con el cliente del usuario: respeta la RLS.
 * Devuelve null si la postulación aún no tiene evaluación.
 */
export async function loadInterviewGuide(supabase: AppSupabaseClient, applicationId: string): Promise<GuideQuestion[] | null> {
  const { data: application, error } = await supabase
    .from("applications")
    .select("vacancy_id, latest_evaluation_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!application?.latest_evaluation_id) return null;

  const { data: evaluation, error: evaluationError } = await supabase
    .from("candidate_evaluations")
    .select("id, method, resume_id, criteria_version")
    .eq("id", application.latest_evaluation_id)
    .maybeSingle();
  if (evaluationError) throw toAppError(evaluationError);
  if (!evaluation) return null;

  // La segunda opinión: la última evaluación con IA del mismo CV y criterios.
  let secondQuery = supabase
    .from("candidate_evaluations")
    .select("id")
    .eq("application_id", applicationId)
    .eq("method", "ia")
    .eq("criteria_version", evaluation.criteria_version)
    .order("created_at", { ascending: false })
    .limit(1);
  secondQuery = evaluation.resume_id ? secondQuery.eq("resume_id", evaluation.resume_id) : secondQuery.is("resume_id", null);

  const [{ data: items, error: itemsError }, { data: requirements, error: requirementsError }, { data: second, error: secondError }] =
    await Promise.all([
      supabase
        .from("candidate_evaluation_items")
        .select("requirement_id, description, category, priority, weight, is_essential, position, assessment, rationale, evidence, signal, verification_source")
        .eq("evaluation_id", evaluation.id)
        .order("position"),
      supabase.from("vacancy_requirements").select("id, min_years").eq("vacancy_id", application.vacancy_id),
      evaluation.method === "reglas" ? secondQuery.maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
  if (itemsError) throw toAppError(itemsError);
  if (requirementsError) throw toAppError(requirementsError);
  if (secondError) throw toAppError(secondError);

  const aiByRequirement = new Map<string, NonNullable<GuideItemInput["ai"]>>();
  if (second) {
    const { data: aiItems, error: aiError } = await supabase
      .from("candidate_evaluation_items")
      .select("requirement_id, assessment, cv_assessment, rationale, cv_rationale, interview_question")
      .eq("evaluation_id", second.id);
    if (aiError) throw toAppError(aiError);
    for (const row of aiItems ?? []) {
      if (!row.requirement_id) continue;
      // Lo que dijo la IA del CV (sin las verificaciones de RRHH aplicadas después).
      aiByRequirement.set(row.requirement_id, {
        assessment: row.cv_assessment ?? row.assessment,
        rationale: row.cv_rationale ?? row.rationale,
        question: row.interview_question,
      });
    }
  }

  const minYears = new Map((requirements ?? []).map((r) => [r.id, r.min_years]));
  return buildInterviewGuide(
    (items ?? []).flatMap((row): GuideItemInput[] =>
      // Requisitos que ya no existen en la vacante (criterios cambiados) no se preguntan.
      row.requirement_id && minYears.has(row.requirement_id)
        ? [
            {
              requirementId: row.requirement_id,
              description: row.description,
              category: row.category,
              priority: row.priority,
              weight: row.weight,
              isEssential: row.is_essential,
              minYears: minYears.get(row.requirement_id) ?? null,
              position: row.position,
              assessment: row.assessment,
              rationale: row.rationale,
              evidence: (Array.isArray(row.evidence) ? row.evidence : []) as Evidence[],
              signal: toEngineSignal(row.signal),
              verified: row.verification_source !== null,
              ai: aiByRequirement.get(row.requirement_id) ?? null,
            },
          ]
        : [],
    ),
  );
}
