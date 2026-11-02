import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { AUDIT_GROUPS } from "./labels";
import { orderRef, pickRequester, REQUEST_ACTIONS, type OrderRequest } from "./requesters";
import type { AuditParams } from "./schemas";

export const AUDIT_PAGE_SIZE = 50;

/** Lima no tiene horario de verano: el día civil empieza siempre a las 00:00 (UTC-5). */
const DAY_MS = 86_400_000;
const startOfDay = (date: string) => new Date(`${date}T00:00:00-05:00`);

export async function listAuditLog(supabase: AppSupabaseClient, params: AuditParams) {
  const rowsFor = (page: number) => {
    const from = (page - 1) * AUDIT_PAGE_SIZE;
    let query = supabase
      .from("audit_logs")
      .select("id, actor_id, action, entity_type, entity_id, metadata, created_at", { count: "exact" });
    if (params.actor === "sistema") query = query.is("actor_id", null);
    else if (params.actor) query = query.eq("actor_id", params.actor);
    if (params.group) query = query.in("entity_type", [...AUDIT_GROUPS[params.group].entities]);
    if (params.from) query = query.gte("created_at", startOfDay(params.from).toISOString());
    if (params.to) query = query.lt("created_at", new Date(startOfDay(params.to).getTime() + DAY_MS).toISOString());
    return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + AUDIT_PAGE_SIZE - 1);
  };

  let page = params.page;
  let result = await rowsFor(page);
  // PGRST103: rango no satisfacible (página posterior a la última).
  if (result.error?.code === "PGRST103") {
    const first = await rowsFor(1);
    if (first.error) throw toAppError(first.error);
    const total = first.count ?? 0;
    page = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
    result = page === 1 ? first : await rowsFor(page);
  }
  if (result.error) throw toAppError(result.error);

  // Acciones del robot: se busca quién dio la orden en la línea previa de la misma publicación.
  const publicationIds = [
    ...new Set(result.data.flatMap((row) => {
      const ref = orderRef(row);
      return ref ? [ref.publicationId] : [];
    })),
  ];
  let requests: OrderRequest[] = [];
  if (publicationIds.length > 0) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("entity_id, action, actor_id, created_at")
      .in("entity_id", publicationIds)
      .in("action", [...REQUEST_ACTIONS])
      .not("actor_id", "is", null);
    if (error) throw toAppError(error);
    requests = data;
  }
  const requesterOf = new Map(result.data.map((row) => [row.id, pickRequester(row, requests)]));

  const actorIds = [
    ...new Set([
      ...result.data.flatMap((row) => (row.actor_id ? [row.actor_id] : [])),
      ...[...requesterOf.values()].flatMap((id) => (id ? [id] : [])),
    ]),
  ];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", actorIds);
    if (error) throw toAppError(error);
    for (const profile of data) names.set(profile.id, profile.full_name);
  }

  return {
    rows: result.data.map((row) => ({
      ...row,
      actor_name: row.actor_id ? (names.get(row.actor_id) ?? "Usuario ya no activo") : "Robot / sistema",
      ordered_by_name: (() => {
        const requesterId = requesterOf.get(row.id);
        return requesterId ? (names.get(requesterId) ?? "Usuario ya no activo") : null;
      })(),
    })),
    total: result.count ?? 0,
    page,
  };
}
