import "server-only";
import { AppError, toAppError } from "@/lib/errors";
import { sanitizeSearchTerm } from "@/lib/search";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { positionsByScore } from "./ranking";
import { DISCARDED_APPLICATION_STATUSES, statusesOfView, type ApplicationListParams, type BoardApplication } from "./schemas";

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
  // «En proceso» y «Descartados» son vistas separadas; un estado de la otra vista no se aplica.
  query =
    params.vista === "descartados"
      ? query.in("status", [...DISCARDED_APPLICATION_STATUSES])
      : query.not("status", "in", `(${DISCARDED_APPLICATION_STATUSES.join(",")})`);
  if (params.status && statusesOfView(params.vista).includes(params.status)) query = query.eq("status", params.status);
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
 * Tope de candidatos sobre el que se calcula la posición. Vienen ordenados por
 * puntuación, así que el tope recorta por abajo: los primeros —los únicos cuya
 * posición se mira— entran siempre. Más allá del tope no se muestra posición.
 */
const RANK_LIMIT = 2000;

export type ApplicationRanking = {
  /** id de la postulación → posición (1 es la mayor puntuación). */
  positions: Map<string, number>;
  /** Cuántos candidatos entran en la comparación. */
  evaluated: number;
};

/**
 * Posición de cada candidato por puntuación DENTRO de la vacante. Es la mitad
 * comparativa de la lectura: el nivel dice si la persona cumple el puesto y la
 * posición dice cuánto destaca entre quienes siguen en carrera. Se calcula al
 * mostrar la vacante, nunca se guarda: dependería del grupo y el mismo
 * candidato cambiaría de valor cada vez que llega otro postulante, lo que
 * rompería el expediente (y la base de datos lo rechazaría).
 *
 * Solo entran los evaluados que siguen en proceso: la posición de alguien ya
 * descartado no significa nada. Los empates comparten posición y consumen
 * hueco (1.º, 2.º, 2.º, 4.º), como en una clasificación deportiva.
 */
export async function rankVacancyApplications(
  supabase: AppSupabaseClient,
  vacancyId: string,
): Promise<ApplicationRanking> {
  const { data, error } = await supabase
    .from("application_overview")
    .select("id, score")
    .eq("vacancy_id", vacancyId)
    .not("status", "in", `(${DISCARDED_APPLICATION_STATUSES.join(",")})`)
    .not("evaluation_id", "is", null)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(RANK_LIMIT);
  if (error) throw toAppError(error);

  const positions = positionsByScore(data ?? []);
  return { positions, evaluated: positions.size };
}

/** Tope de tarjetas que muestra el tablero (vista embudo), por prudencia. */
const BOARD_LIMIT = 500;

/**
 * Todos los candidatos de la vacante para la vista de tablero (embudo),
 * ordenados por puntuación. No se pagina: el tablero agrupa por situación en el
 * cliente. No oculta compatibilidades bajas (igual que el listado).
 */
export async function listApplicationsForBoard(
  supabase: AppSupabaseClient,
  vacancyId: string,
): Promise<BoardApplication[]> {
  const { data, error } = await supabase
    .from("application_overview")
    .select("id, candidate_name, status, score, level, evaluation_id")
    .eq("vacancy_id", vacancyId)
    .order("score", { ascending: false, nullsFirst: false })
    .order("applied_at", { ascending: false })
    .limit(BOARD_LIMIT);
  if (error) throw toAppError(error);
  return (data ?? []).flatMap((row) =>
    row.id
      ? [{
          id: row.id,
          candidate_name: row.candidate_name,
          status: row.status,
          score: row.score,
          level: row.level,
          evaluation_id: row.evaluation_id,
        }]
      : [],
  );
}

/** Cuántas postulaciones tiene la vacante en cada vista (sin búsqueda ni filtros). */
export async function countApplicationViews(supabase: AppSupabaseClient, vacancyId: string) {
  const base = () => supabase.from("application_overview").select("id", { count: "exact", head: true }).eq("vacancy_id", vacancyId);
  const [discarded, total] = await Promise.all([base().in("status", [...DISCARDED_APPLICATION_STATUSES]), base()]);
  if (discarded.error) throw toAppError(discarded.error);
  if (total.error) throw toAppError(total.error);
  return { discarded: discarded.count ?? 0, inProcess: (total.count ?? 0) - (discarded.count ?? 0) };
}

/** Total de postulaciones de una vacante (cualquier estado). */
export async function countVacancyApplications(supabase: AppSupabaseClient, vacancyId: string): Promise<number> {
  const { count, error } = await supabase
    .from("application_overview")
    .select("id", { count: "exact", head: true })
    .eq("vacancy_id", vacancyId);
  if (error) throw toAppError(error);
  return count ?? 0;
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
      // Los avisos de la lectura del CV (texto oculto, relleno de palabras clave, OCR…) se
      // muestran junto a la evaluación, que es donde RRHH mira el puntaje.
      "*, author:profiles!candidate_evaluations_created_by_fkey(full_name), reviewer:profiles!candidate_evaluations_reviewed_by_fkey(full_name), resume:resumes(version, original_filename, resume_extractions(warnings))",
    )
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw toAppError(error);
  return data;
}

export async function listEvaluationItems(supabase: AppSupabaseClient, evaluationId: string) {
  const { data, error } = await supabase
    .from("candidate_evaluation_items")
    .select("*, verifier:profiles!candidate_evaluation_items_verified_by_fkey(full_name)")
    .eq("evaluation_id", evaluationId)
    .order("position");
  if (error) throw toAppError(error);
  return data;
}

/** Verificaciones vigentes de RRHH (una por requisito) de la postulación. */
export async function listRequirementVerifications(supabase: AppSupabaseClient, applicationId: string) {
  const { data, error } = await supabase
    .from("requirement_verifications")
    .select("requirement_id, result, source, note")
    .eq("application_id", applicationId);
  if (error) throw toAppError(error);
  return data;
}

/** Respuestas a las preguntas eliminatorias de una postulación (las que no cumplen, primero). */
export async function listKillerAnswers(supabase: AppSupabaseClient, applicationId: string) {
  const { data, error } = await supabase
    .from("application_killer_answers")
    .select(
      "id, meets, answer_boolean, answer_number, answer_text, question:vacancy_killer_questions(question, question_type, position)",
    )
    .eq("application_id", applicationId);
  if (error) throw toAppError(error);
  return data.sort(
    (a, b) => Number(a.meets) - Number(b.meets) || (a.question?.position ?? 0) - (b.question?.position ?? 0),
  );
}

/** Cuántas respuestas que no cumplen tiene cada postulación (solo las que tienen alguna). */
export async function countKillerFlags(supabase: AppSupabaseClient, applicationIds: string[]) {
  const flags = new Map<string, number>();
  if (applicationIds.length === 0) return flags;
  const { data, error } = await supabase
    .from("application_killer_answers")
    .select("application_id")
    .in("application_id", applicationIds)
    .eq("meets", false);
  if (error) throw toAppError(error);
  for (const row of data) flags.set(row.application_id, (flags.get(row.application_id) ?? 0) + 1);
  return flags;
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
