import "server-only";
import { z } from "zod";
import { AppError, toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeFunnel,
  computeKpis,
  computeSideCounts,
  computeSources,
  computeTimes,
  computeTrend,
  type ReportApplication,
  type ReportStatusEvent,
} from "./metrics";
import type { ExportRow } from "./csv";

/** Todas las consultas usan el cliente del usuario: la RLS define su ámbito. */

const PAGE = 1000;
/** Tope de filas leídas por consulta; si se alcanza, el reporte avisa que es parcial. */
const MAX_ROWS = 20_000;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportParamsSchema = z.object({
  vacante: z.uuid().optional().catch(undefined),
  desde: dateString.optional().catch(undefined),
  hasta: dateString.optional().catch(undefined),
});
export type ReportParams = z.infer<typeof reportParamsSchema>;

export async function listReportVacancies(supabase: AppSupabaseClient) {
  const { data, error } = await supabase.from("vacancies").select("id, title, department").order("title").limit(500);
  if (error) throw toAppError(error);
  return data;
}

async function fetchAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  let truncated = false;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw toAppError(error as Parameters<typeof toAppError>[0]);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }
  return { rows, truncated };
}

export async function getReport(supabase: AppSupabaseClient, params: ReportParams) {
  // Rango de fechas (inclusive). Filtra por fecha de postulación y por fecha de
  // los cambios de estado, de forma coherente.
  const fromDate = params.desde ? `${params.desde}T00:00:00.000Z` : null;
  const toDate = params.hasta ? `${params.hasta}T23:59:59.999Z` : null;

  const appsResult = await fetchAll((from, to) => {
    let query = supabase
      .from("applications")
      .select("id, candidate_id, status, applied_at, candidates!inner(source)")
      .order("id")
      .range(from, to);
    if (params.vacante) query = query.eq("vacancy_id", params.vacante);
    if (fromDate) query = query.gte("applied_at", fromDate);
    if (toDate) query = query.lte("applied_at", toDate);
    return query;
  });
  const apps: ReportApplication[] = appsResult.rows.map((row) => ({
    id: row.id,
    candidateId: row.candidate_id,
    status: row.status,
    appliedAt: row.applied_at,
    source: row.candidates.source,
  }));

  const eventsResult = await fetchAll((from, to) => {
    let query = supabase
      .from("application_events")
      .select("id, application_id, from_status, to_status, created_at, applications!inner(vacancy_id)")
      .eq("event_type", "cambio_estado")
      .order("id")
      .range(from, to);
    if (params.vacante) query = query.eq("applications.vacancy_id", params.vacante);
    if (fromDate) query = query.gte("created_at", fromDate);
    if (toDate) query = query.lte("created_at", toDate);
    return query;
  });
  const events: ReportStatusEvent[] = eventsResult.rows.flatMap((row) =>
    row.from_status && row.to_status
      ? [{ applicationId: row.application_id, fromStatus: row.from_status, toStatus: row.to_status, createdAt: row.created_at }]
      : [],
  );

  return {
    totalApplications: apps.length,
    kpis: computeKpis(apps),
    funnel: computeFunnel(apps, events),
    side: computeSideCounts(apps),
    sources: computeSources(apps, events),
    trend: computeTrend(apps),
    times: computeTimes(apps, events),
    truncated: appsResult.truncated || eventsResult.truncated,
  };
}

/** Filas del CSV de una vacante (ámbito RLS). Devuelve null si la vacante no es visible. */
export async function getVacancyExportRows(
  supabase: AppSupabaseClient,
  vacancyId: string,
): Promise<{ vacancyId: string; rows: ExportRow[] } | null> {
  const { data: vacancy, error: vacancyError } = await supabase
    .from("vacancies")
    .select("id")
    .eq("id", vacancyId)
    .maybeSingle();
  if (vacancyError) throw toAppError(vacancyError);
  if (!vacancy) return null;

  const overview = await fetchAll((from, to) =>
    supabase
      .from("application_overview")
      .select("id, candidate_id, candidate_name, candidate_email, status, applied_at, level, score, review_status")
      .eq("vacancy_id", vacancyId)
      .order("applied_at")
      .range(from, to),
  );

  const candidateIds = [...new Set(overview.rows.flatMap((r) => (r.candidate_id ? [r.candidate_id] : [])))];
  const details = new Map<string, { source: ExportRow["source"]; phone: string | null; location: string | null }>();
  for (let i = 0; i < candidateIds.length; i += 200) {
    const { data, error } = await supabase
      .from("candidates")
      .select("id, source, phone, location")
      .in("id", candidateIds.slice(i, i + 200));
    if (error) throw toAppError(error);
    for (const c of data) details.set(c.id, { source: c.source, phone: c.phone, location: c.location });
  }

  const rows: ExportRow[] = overview.rows.flatMap((r) => {
    if (!r.status || !r.candidate_id) return [];
    const detail = details.get(r.candidate_id);
    return [
      {
        candidateName: r.candidate_name ?? "",
        email: r.candidate_email,
        phone: detail?.phone ?? null,
        location: detail?.location ?? null,
        source: detail?.source ?? "otro",
        status: r.status,
        appliedAt: r.applied_at,
        level: r.level,
        score: r.score,
        reviewStatus: r.review_status,
      },
    ];
  });
  return { vacancyId, rows };
}

/**
 * Auditoría de la exportación. Solo identificadores y conteos: nunca nombres,
 * correos ni ningún valor del CSV. Si falla, la exportación no se entrega.
 *
 * `audit_logs` no admite INSERT del usuario y no hay función RPC genérica, por
 * eso se escribe con el cliente de servicio, SOLO después de que la ruta haya
 * verificado sesión, permiso y visibilidad de la vacante.
 */
export async function logReportExport(actorId: string, vacancyId: string, rowCount: number): Promise<void> {
  const { error } = await createSupabaseAdminClient()
    .from("audit_logs")
    .insert({
      actor_id: actorId,
      action: "reporte_exportado",
      entity_type: "vacancies",
      entity_id: vacancyId,
      metadata: { format: "csv", report: "postulaciones", rows: rowCount },
    });
  if (error) throw new AppError("No se pudo registrar la auditoría de la exportación.", "unavailable");
}
