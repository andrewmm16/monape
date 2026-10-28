import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { InboxParams } from "./schemas";

export const INBOX_PAGE_SIZE = 20;

export async function listActivePortals(supabase: AppSupabaseClient) {
  const { data, error } = await supabase
    .from("job_portals")
    .select("id, name, kind")
    .eq("is_active", true)
    .order("position");
  if (error) throw toAppError(error);
  return data;
}

/** Todos los portales (también inactivos): para filtrar la bandeja. */
export async function listPortals(supabase: AppSupabaseClient) {
  const { data, error } = await supabase.from("job_portals").select("id, name").order("position");
  if (error) throw toAppError(error);
  return data;
}

/** Lote abierto de la persona en la vacante, si lo hay (se continúa al volver). */
export async function getOpenBatch(supabase: AppSupabaseClient, vacancyId: string, userId: string) {
  const { data, error } = await supabase
    .from("intake_batches")
    .select("id, portal_id, created_at, job_portals(name)")
    .eq("vacancy_id", vacancyId)
    .eq("created_by", userId)
    .eq("status", "abierto")
    .maybeSingle();
  if (error) throw toAppError(error);
  return data;
}

/** Ítems del lote sin el texto completo del CV. */
export async function listBatchItems(supabase: AppSupabaseClient, batchId: string) {
  const { data, error } = await supabase
    .from("intake_batch_items")
    .select(
      "id, status, original_filename, extraction_status, extraction_method, suggested_fields, warnings, full_name, email, phone, name_from_cv, error_code, application_id",
    )
    .eq("batch_id", batchId)
    .order("created_at");
  if (error) throw toAppError(error);
  return data;
}

export async function listBatchDuplicates(supabase: AppSupabaseClient, batchId: string) {
  const { data, error } = await supabase.rpc("batch_item_duplicates", { p_batch_id: batchId });
  if (error) throw toAppError(error);
  return data;
}

/**
 * Postulaciones nuevas de todas las vacantes, de la más reciente a la más
 * antigua. Una página fuera de rango devuelve la última página en vez de fallar.
 */
export async function listInbox(supabase: AppSupabaseClient, params: InboxParams) {
  const rowsFor = (page: number) => {
    const from = (page - 1) * INBOX_PAGE_SIZE;
    let query = supabase.from("application_overview").select("*", { count: "exact" }).eq("status", "nuevo");
    if (params.vacancy) query = query.eq("vacancy_id", params.vacancy);
    if (params.portal) query = query.eq("portal_id", params.portal);
    if (params.method) query = query.eq("intake_method", params.method);
    return query.order("applied_at", { ascending: false }).range(from, from + INBOX_PAGE_SIZE - 1);
  };

  const first = await rowsFor(params.page);
  if (!first.error) return { rows: first.data, total: first.count ?? 0, page: params.page };
  // PGRST103: rango no satisfacible (página posterior a la última).
  if (first.error.code !== "PGRST103") throw toAppError(first.error);

  let countQuery = supabase.from("application_overview").select("id", { count: "exact", head: true }).eq("status", "nuevo");
  if (params.vacancy) countQuery = countQuery.eq("vacancy_id", params.vacancy);
  if (params.portal) countQuery = countQuery.eq("portal_id", params.portal);
  if (params.method) countQuery = countQuery.eq("intake_method", params.method);
  const { count, error: countError } = await countQuery;
  if (countError) throw toAppError(countError);
  const total = count ?? 0;
  if (total === 0) return { rows: [], total: 0, page: 1 };
  const page = Math.ceil(total / INBOX_PAGE_SIZE);
  const last = await rowsFor(page);
  if (last.error) throw toAppError(last.error);
  return { rows: last.data, total, page };
}
