import "server-only";
import { AppError, toAppError } from "@/lib/errors";
import { sanitizeSearchTerm } from "@/lib/search";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { ApplicationListParams } from "./schemas";

export const APPLICATIONS_PAGE_SIZE = 20;

/**
 * Todos los candidatos de una vacante (sin ocultar compatibilidades bajas),
 * con búsqueda, filtros, orden y paginación.
 */
export async function listVacancyApplications(
  supabase: AppSupabaseClient,
  vacancyId: string,
  params: ApplicationListParams,
) {
  const from = (params.page - 1) * APPLICATIONS_PAGE_SIZE;
  let query = supabase
    .from("application_overview")
    .select("*", { count: "exact" })
    .eq("vacancy_id", vacancyId)
    .range(from, from + APPLICATIONS_PAGE_SIZE - 1);

  const term = sanitizeSearchTerm(params.q);
  if (term) query = query.or(`candidate_name.ilike.%${term}%,candidate_email.ilike.%${term}%`);
  if (params.status) query = query.eq("status", params.status);
  if (params.level === "sin_evaluar") query = query.is("evaluation_id", null);
  else if (params.level) query = query.eq("level", params.level);

  if (params.sort === "fecha") query = query.order("applied_at", { ascending: false });
  else if (params.sort === "nombre") query = query.order("candidate_name", { ascending: true });
  else query = query.order("score", { ascending: false, nullsFirst: false }).order("applied_at", { ascending: false });

  const { data, error, count } = await query;
  if (error) throw toAppError(error);
  return { rows: data, total: count ?? 0 };
}

/**
 * Postulaciones pendientes de evaluar de una vacante: no retiradas y sin
 * evaluación, o con una evaluación hecha con criterios anteriores. Es la única
 * definición de «pendiente»; la usan el conteo y la evaluación por tramos.
 */
export function pendingEvaluationsQuery(supabase: AppSupabaseClient, vacancyId: string, options: { head?: boolean } = {}) {
  return supabase
    .from("application_overview")
    .select("id, candidate_name", { count: "exact", head: options.head ?? false })
    .eq("vacancy_id", vacancyId)
    .neq("status", "retirado")
    .or("evaluation_id.is.null,evaluation_outdated.eq.true");
}

export async function countPendingEvaluations(supabase: AppSupabaseClient, vacancyId: string): Promise<number> {
  const { count, error } = await pendingEvaluationsQuery(supabase, vacancyId, { head: true });
  if (error) throw toAppError(error);
  return count ?? 0;
}

export async function getApplicationDetail(supabase: AppSupabaseClient, applicationId: string) {
  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, public_reference, status, applied_at, status_changed_at, latest_evaluation_id, assigned_evaluator_id, opinion_requested_at, opinion_answered_at, candidate_id, opinion_from:profiles!applications_assigned_evaluator_id_fkey(full_name), opinion_requester:profiles!applications_opinion_requested_by_fkey(full_name), resume:resumes!applications_resume_fk(id, version, original_filename), candidate:candidates(id, full_name, email), vacancy:vacancies(id, title, department, status, criteria_version, criteria_approved_at)",
    )
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data?.candidate || !data.vacancy) throw new AppError("La postulación no existe o no tiene acceso.", "not_found");
  return { ...data, candidate: data.candidate, vacancy: data.vacancy };
}

export async function listEvaluations(supabase: AppSupabaseClient, applicationId: string) {
  const { data, error } = await supabase
    .from("candidate_evaluations")
    .select(
      "*, author:profiles!candidate_evaluations_created_by_fkey(full_name), reviewer:profiles!candidate_evaluations_reviewed_by_fkey(full_name), resume:resumes(version, original_filename)",
    )
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw toAppError(error);
  return data;
}

export async function listEvaluationItems(supabase: AppSupabaseClient, evaluationId: string) {
  const { data, error } = await supabase
    .from("candidate_evaluation_items")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .order("position");
  if (error) throw toAppError(error);
  return data;
}

export async function listApplicationEvents(supabase: AppSupabaseClient, applicationId: string) {
  const { data, error } = await supabase
    .from("application_events")
    .select("*, actor:profiles!application_events_actor_id_fkey(full_name)")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw toAppError(error);
  return data;
}

/** Versión vigente del CV del candidato (para ofrecer actualizar la postulación). */
export async function getCurrentResume(supabase: AppSupabaseClient, candidateId: string) {
  const { data, error } = await supabase
    .from("resumes")
    .select("id, version")
    .eq("candidate_id", candidateId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data;
}
