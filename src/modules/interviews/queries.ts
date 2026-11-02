import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { listRequirements } from "@/modules/vacancies/queries";
import type { InterviewRequirement } from "./schemas";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Días que se muestran en «Realizadas recientemente». */
export const RECENT_DAYS = 30;
const PENDING_LIMIT = 200;
const UPCOMING_LIMIT = 300;
const RECENT_LIMIT = 100;

/** Entrevista con la postulación, el candidato y la vacante (para listados). */
const LIST_SELECT =
  "id, application_id, scheduled_at, duration_minutes, modality, location, interviewers, instructions, status, result, result_notes, cancel_reason, applications!inner(id, status, vacancy_id, candidates(id, full_name), vacancies(id, title, status))";

export type InterviewRow = Awaited<ReturnType<typeof listAgenda>>["pending"][number];

type AgendaFilters = { vacancyId?: string };

/**
 * Agenda de /entrevistas: programadas cuya hora ya pasó (pendientes de
 * resultado), próximas programadas y las cerradas en los últimos 30 días.
 * Usa el cliente del usuario: la RLS decide qué puede ver.
 */
export async function listAgenda(supabase: AppSupabaseClient, filters: AgendaFilters = {}, now: Date = new Date()) {
  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString();
  const base = () => {
    let query = supabase.from("interviews").select(LIST_SELECT);
    if (filters.vacancyId) query = query.eq("applications.vacancy_id", filters.vacancyId);
    return query;
  };

  const [pending, upcoming, recent] = await Promise.all([
    base().eq("status", "programada").lt("scheduled_at", nowIso).order("scheduled_at", { ascending: true }).limit(PENDING_LIMIT),
    base().eq("status", "programada").gte("scheduled_at", nowIso).order("scheduled_at", { ascending: true }).limit(UPCOMING_LIMIT),
    base().neq("status", "programada").gte("updated_at", since).order("updated_at", { ascending: false }).limit(RECENT_LIMIT),
  ]);
  for (const result of [pending, upcoming, recent]) if (result.error) throw toAppError(result.error);
  return { pending: pending.data ?? [], upcoming: upcoming.data ?? [], recent: recent.data ?? [] };
}

/** Todas las entrevistas de una postulación, de la más reciente a la más antigua. */
export async function listApplicationInterviews(supabase: AppSupabaseClient, applicationId: string) {
  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, application_id, scheduled_at, duration_minutes, modality, location, interviewers, instructions, status, result, result_notes, cancel_reason, result_recorder:profiles!interviews_result_recorded_by_fkey(full_name)",
    )
    .eq("application_id", applicationId)
    .order("scheduled_at", { ascending: false });
  if (error) throw toAppError(error);
  return data;
}

/** Próximas entrevistas programadas (panel): desde ahora y dentro de `days` días. */
export async function listUpcomingInterviews(
  supabase: AppSupabaseClient,
  options: { limit: number; days: number },
  now: Date = new Date(),
) {
  const { data, error } = await supabase
    .from("interviews")
    .select(LIST_SELECT)
    .eq("status", "programada")
    .gte("scheduled_at", now.toISOString())
    .lt("scheduled_at", new Date(now.getTime() + options.days * DAY_MS).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(options.limit);
  if (error) throw toAppError(error);
  return data;
}

/** Vacantes para el filtro de /entrevistas. */
export async function listVacancyOptions(supabase: AppSupabaseClient) {
  const { data, error } = await supabase.from("vacancies").select("id, title").order("title").limit(300);
  if (error) throw toAppError(error);
  return data;
}

/**
 * Requisitos vigentes de la vacante de la entrevista con su valoración actual
 * (última evaluación de la postulación), para marcar los comprobados.
 */
export async function listInterviewRequirements(
  supabase: AppSupabaseClient,
  interviewId: string,
): Promise<InterviewRequirement[]> {
  const { data: interview, error } = await supabase
    .from("interviews")
    .select("application_id, applications!inner(vacancy_id, latest_evaluation_id)")
    .eq("id", interviewId)
    .maybeSingle();
  if (error) throw toAppError(error);
  const application = interview?.applications;
  if (!interview || !application) return [];

  const requirements = await listRequirements(supabase, application.vacancy_id);
  const assessed = new Map<string, { assessment: InterviewRequirement["assessment"]; verified: boolean }>();
  if (application.latest_evaluation_id) {
    const { data: items, error: itemsError } = await supabase
      .from("candidate_evaluation_items")
      .select("requirement_id, assessment, verification_source")
      .eq("evaluation_id", application.latest_evaluation_id);
    if (itemsError) throw toAppError(itemsError);
    for (const item of items) {
      if (item.requirement_id) assessed.set(item.requirement_id, { assessment: item.assessment, verified: item.verification_source !== null });
    }
  }
  return requirements.map((requirement) => ({
    id: requirement.id,
    description: requirement.description,
    priority: requirement.priority,
    assessment: assessed.get(requirement.id)?.assessment ?? null,
    verified: assessed.get(requirement.id)?.verified ?? false,
  }));
}

export type InterviewSummary = {
  /** Resultado de la última entrevista realizada; null si no hay. */
  lastResult: "paso" | "no_paso" | null;
  lastScheduledAt: string | null;
  /** Próxima entrevista programada (la más cercana); null si no hay. */
  nextScheduledAt: string | null;
};

/** Resumen de entrevistas por postulación (comparación). Las que no tienen entrevistas no aparecen. */
export async function summarizeInterviews(
  supabase: AppSupabaseClient,
  applicationIds: string[],
): Promise<Map<string, InterviewSummary>> {
  const summaries = new Map<string, InterviewSummary>();
  if (applicationIds.length === 0) return summaries;
  const { data, error } = await supabase
    .from("interviews")
    .select("application_id, scheduled_at, status, result")
    .in("application_id", applicationIds)
    .in("status", ["programada", "realizada"])
    .order("scheduled_at", { ascending: true });
  if (error) throw toAppError(error);
  for (const row of data) {
    const summary = summaries.get(row.application_id) ?? { lastResult: null, lastScheduledAt: null, nextScheduledAt: null };
    if (row.status === "realizada") {
      // Orden ascendente: la última realizada sobrescribe a las anteriores.
      summary.lastResult = row.result;
      summary.lastScheduledAt = row.scheduled_at;
    } else if (!summary.nextScheduledAt) {
      summary.nextScheduledAt = row.scheduled_at;
    }
    summaries.set(row.application_id, summary);
  }
  return summaries;
}

/** Fila de listado → datos para mostrar (forma que usa `InterviewItem`). */
export function toInterviewItem(row: InterviewRow) {
  const { applications: application, ...interview } = row;
  return {
    ...interview,
    application: {
      id: application.id,
      status: application.status,
      candidateName: application.candidates?.full_name ?? null,
      vacancyId: application.vacancy_id,
      vacancyTitle: application.vacancies?.title ?? null,
      vacancyStatus: application.vacancies?.status ?? null,
    },
  };
}
