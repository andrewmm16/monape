import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
import { compareIncidents, notificationDeadline, type DeadlineEvent } from "./deadlines";

export type IncidentRow = Tables<"security_incidents">;

export type IncidentListItem = IncidentRow & { events: DeadlineEvent[] };

/** Los incidentes (abiertos primero) con lo mínimo de su bitácora para calcular el plazo. */
export async function listIncidents(supabase: AppSupabaseClient): Promise<IncidentListItem[]> {
  const [incidents, events] = await Promise.all([
    supabase.from("security_incidents").select("*").order("detected_at", { ascending: false }).limit(500),
    supabase.from("security_incident_events").select("incident_id, kind, recipient").eq("kind", "notificacion").limit(5000),
  ]);
  if (incidents.error) throw toAppError(incidents.error);
  if (events.error) throw toAppError(events.error);
  const byIncident = new Map<string, DeadlineEvent[]>();
  for (const event of events.data) {
    const list = byIncident.get(event.incident_id) ?? [];
    list.push({ kind: event.kind, recipient: event.recipient });
    byIncident.set(event.incident_id, list);
  }
  return incidents.data
    .map((row) => ({ ...row, events: byIncident.get(row.id) ?? [] }))
    .sort((a, b) => compareIncidents({ status: a.status, detectedAt: a.detected_at }, { status: b.status, detectedAt: b.detected_at }));
}

export async function getIncident(supabase: AppSupabaseClient, id: string): Promise<IncidentRow | null> {
  const { data, error } = await supabase.from("security_incidents").select("*").eq("id", id).maybeSingle();
  if (error) throw toAppError(error);
  return data;
}

export type IncidentEventRow = Tables<"security_incident_events"> & { author: { full_name: string } | null };

export async function listIncidentEvents(supabase: AppSupabaseClient, incidentId: string): Promise<IncidentEventRow[]> {
  const { data, error } = await supabase
    .from("security_incident_events")
    .select("*, author:profiles!security_incident_events_created_by_fkey(full_name)")
    .eq("incident_id", incidentId)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw toAppError(error);
  return data;
}

export type SecurityOfficer = { name: string; email: string; designatedAt: string | null };

/** El oficial de datos personales designado; null si todavía no hay. */
export async function getSecurityOfficer(supabase: AppSupabaseClient): Promise<SecurityOfficer | null> {
  const { data, error } = await supabase.from("security_settings").select("officer_name, officer_email, designated_at").maybeSingle();
  if (error) throw toAppError(error);
  if (!data?.officer_name || !data.officer_email) return null;
  return { name: data.officer_name, email: data.officer_email, designatedAt: data.designated_at };
}

/** Fecha en que se detectó el último simulacro (el más reciente), o null si nunca se hizo. */
export async function getLastDrillAt(supabase: AppSupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("security_incidents")
    .select("detected_at")
    .eq("is_drill", true)
    .order("detected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data?.detected_at ?? null;
}

export type OpenIncidentsSummary = {
  count: number;
  /** Vencimiento más próximo entre los plazos de aviso a la Autoridad sin cumplir; null si ninguno aplica. */
  nextDueAt: Date | null;
  /** ¿Ese vencimiento ya pasó? */
  overdue: boolean;
};

/** Para el aviso del panel: incidentes sin cerrar (abiertos o contenidos) que no son simulacros: el plazo de aviso sigue corriendo. */
export async function getOpenIncidentsSummary(supabase: AppSupabaseClient, now: Date = new Date()): Promise<OpenIncidentsSummary> {
  const { data, error } = await supabase
    .from("security_incidents")
    .select("id, severity, is_drill, affected_data, detected_at")
    .neq("status", "cerrado")
    .eq("is_drill", false);
  if (error) throw toAppError(error);
  if (data.length === 0) return { count: 0, nextDueAt: null, overdue: false };
  const events = await supabase
    .from("security_incident_events")
    .select("incident_id, kind, recipient")
    .eq("kind", "notificacion")
    .in(
      "incident_id",
      data.map((row) => row.id),
    );
  if (events.error) throw toAppError(events.error);
  let nextDueAt: Date | null = null;
  for (const row of data) {
    const deadline = notificationDeadline(
      { severity: row.severity, isDrill: row.is_drill, affectedData: row.affected_data, detectedAt: row.detected_at },
      events.data.filter((event) => event.incident_id === row.id),
      now,
    );
    if (deadline.applies && !deadline.fulfilled && (!nextDueAt || deadline.dueAt < nextDueAt)) nextDueAt = deadline.dueAt;
  }
  return { count: data.length, nextDueAt, overdue: nextDueAt ? nextDueAt.getTime() <= now.getTime() : false };
}
