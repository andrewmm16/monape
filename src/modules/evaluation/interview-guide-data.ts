import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { buildInterviewGuide, type GuideItemInput, type GuideQuestion } from "./interview-guide";
import { toEngineSignal, type Evidence } from "./types";

/** Postulación con lo necesario para armar su guía. */
export type GuideApplicationRef = { id: string; vacancy_id: string; latest_evaluation_id: string | null };

/** Cliente del usuario (respeta la RLS) o de administración (worker de IA). */
type AnyClient = AppSupabaseClient | SupabaseClient<Database>;

/**
 * Ítems de la guía de una postulación, con la evaluación vigente de la que salen
 * y su clave de vigencia (CV y versión de criterios), que usan también las
 * preguntas para profundizar (deep-dive.ts).
 */
export type GuideItemsBundle = { evaluationId: string; resumeId: string | null; criteriaVersion: number; items: GuideItemInput[] };

/** Tamaño de cada tanda de `in(...)`: con ~10 requisitos por vacante queda lejos del máximo de filas de la API. */
const CHUNK = 50;

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

async function inChunks<T>(ids: string[], query: (ids: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunks(ids)) {
    const { data, error } = await query(part);
    if (error) throw toAppError(error);
    rows.push(...(data ?? []));
  }
  return rows;
}

const ITEM_COLUMNS =
  "evaluation_id, requirement_id, description, category, priority, weight, is_essential, position, assessment, rationale, evidence, signal, verification_source";

/**
 * Ítems de la guía de varias postulaciones (la bandeja de una vacante), con
 * pocas consultas: la evaluación vigente de cada una (la del motor, con lo que
 * relevó la IA) y la segunda opinión de la IA del mismo CV y criterios (su
 * pregunta y su motivo). Con el cliente del usuario respeta la RLS. Las
 * postulaciones sin evaluación no aparecen en el resultado.
 */
export async function loadGuideItems(supabase: AnyClient, applications: GuideApplicationRef[]): Promise<Map<string, GuideItemsBundle>> {
  const evaluated = applications.filter((a): a is GuideApplicationRef & { latest_evaluation_id: string } => Boolean(a.latest_evaluation_id));
  if (evaluated.length === 0) return new Map();
  const evaluationIds = evaluated.map((a) => a.latest_evaluation_id);
  const vacancyIds = [...new Set(evaluated.map((a) => a.vacancy_id))];

  const [evaluations, items, requirements, aiEvaluations] = await Promise.all([
    inChunks(evaluationIds, (ids) =>
      supabase.from("candidate_evaluations").select("id, application_id, method, resume_id, criteria_version").in("id", ids),
    ),
    inChunks(evaluationIds, (ids) => supabase.from("candidate_evaluation_items").select(ITEM_COLUMNS).in("evaluation_id", ids).order("position")),
    inChunks(vacancyIds, (ids) => supabase.from("vacancy_requirements").select("id, min_years").in("vacancy_id", ids)),
    inChunks(
      evaluated.map((a) => a.id),
      (ids) =>
        supabase
          .from("candidate_evaluations")
          .select("id, application_id, resume_id, criteria_version")
          .in("application_id", ids)
          .eq("method", "ia")
          .order("created_at", { ascending: false }),
    ),
  ]);

  // La segunda opinión de cada postulación: la última con IA del mismo CV y criterios.
  const secondByApplication = new Map<string, string>();
  for (const evaluation of evaluations) {
    if (evaluation.method !== "reglas") continue;
    const second = aiEvaluations.find(
      (ai) => ai.application_id === evaluation.application_id && ai.resume_id === evaluation.resume_id && ai.criteria_version === evaluation.criteria_version,
    );
    if (second) secondByApplication.set(evaluation.application_id, second.id);
  }
  const aiItems = await inChunks([...secondByApplication.values()], (ids) =>
    supabase
      .from("candidate_evaluation_items")
      .select("evaluation_id, requirement_id, assessment, cv_assessment, rationale, cv_rationale, interview_question")
      .in("evaluation_id", ids),
  );
  // Lo que dijo la IA del CV (sin las verificaciones de RRHH aplicadas después).
  const aiByEvaluation = new Map<string, Map<string, NonNullable<GuideItemInput["ai"]>>>();
  for (const row of aiItems) {
    if (!row.requirement_id) continue;
    const map = aiByEvaluation.get(row.evaluation_id) ?? new Map();
    map.set(row.requirement_id, { assessment: row.cv_assessment ?? row.assessment, rationale: row.cv_rationale ?? row.rationale, question: row.interview_question });
    aiByEvaluation.set(row.evaluation_id, map);
  }

  const minYears = new Map(requirements.map((r) => [r.id, r.min_years]));
  const itemsByEvaluation = new Map<string, typeof items>();
  for (const row of items) itemsByEvaluation.set(row.evaluation_id, [...(itemsByEvaluation.get(row.evaluation_id) ?? []), row]);

  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const bundles = new Map<string, GuideItemsBundle>();
  for (const application of evaluated) {
    const evaluation = evaluationById.get(application.latest_evaluation_id);
    if (!evaluation) continue;
    const secondId = secondByApplication.get(application.id);
    const ai = secondId ? aiByEvaluation.get(secondId) : undefined;
    const rows = itemsByEvaluation.get(application.latest_evaluation_id) ?? [];
    bundles.set(application.id, {
      evaluationId: evaluation.id,
      resumeId: evaluation.resume_id,
      criteriaVersion: evaluation.criteria_version,
      items: rows.flatMap((row): GuideItemInput[] =>
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
                ai: ai?.get(row.requirement_id) ?? null,
              },
            ]
          : [],
      ),
    });
  }
  return bundles;
}

/** Guías de entrevista de varias postulaciones: lo que falta confirmar de cada una (ver loadGuideItems). */
export async function loadInterviewGuides(
  supabase: AppSupabaseClient,
  applications: GuideApplicationRef[],
): Promise<Map<string, GuideQuestion[]>> {
  const bundles = await loadGuideItems(supabase, applications);
  return new Map([...bundles].map(([applicationId, bundle]) => [applicationId, buildInterviewGuide(bundle.items)]));
}

/** Guía de entrevista de una postulación; null si aún no tiene evaluación. */
export async function loadInterviewGuide(supabase: AppSupabaseClient, applicationId: string): Promise<GuideQuestion[] | null> {
  const { data: application, error } = await supabase
    .from("applications")
    .select("id, vacancy_id, latest_evaluation_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!application?.latest_evaluation_id) return null;
  return (await loadInterviewGuides(supabase, [application])).get(application.id) ?? null;
}
