import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type PortalPublicationRow = {
  /** `bot_enabled`: el robot ya sabe atender este portal. */
  portal: Pick<Tables<"job_portals">, "id" | "name" | "bot_enabled">;
  publication: Pick<
    Tables<"portal_publications">,
    "id" | "status" | "external_id" | "external_url" | "error_code" | "published_at" | "last_synced_at" | "requested_at"
  > | null;
};

/**
 * Portales de empleo en los que RRHH publica a mano o con el robot, cada uno con
 * la publicación de esta vacante (si la hay). Los portales automáticos (feeds)
 * y «Otro» no se eligen aquí.
 */
export async function listPortalPublications(supabase: AppSupabaseClient, vacancyId: string): Promise<PortalPublicationRow[]> {
  const [portals, publications] = await Promise.all([
    supabase
      .from("job_portals")
      .select("id, name, bot_enabled")
      .eq("kind", "manual")
      .eq("is_active", true)
      .neq("name", "Otro")
      .order("bot_enabled", { ascending: false })
      .order("position"),
    supabase
      .from("portal_publications")
      .select("id, portal_id, status, external_id, external_url, error_code, published_at, last_synced_at, requested_at")
      .eq("vacancy_id", vacancyId),
  ]);
  if (portals.error) throw toAppError(portals.error);
  if (publications.error) throw toAppError(publications.error);
  return (portals.data ?? []).map((portal) => ({
    portal,
    publication: publications.data?.find((p) => p.portal_id === portal.id) ?? null,
  }));
}

/** Sin señal del robot durante este tiempo se considera apagado o caído. */
export const BOT_SILENCE_MINUTES = 15;

export type BotAlert = {
  portalName: string;
  kind: "necesita_persona" | "sin_senal";
  reason: string | null;
  seenAt: string;
};

/**
 * Avisos del robot para RRHH: se detuvo esperando a una persona (CAPTCHA,
 * verificación, sesión vencida) o dejó de dar señales. Un robot que nunca se
 * conectó no genera aviso.
 */
export async function listBotAlerts(supabase: AppSupabaseClient, now: Date = new Date()): Promise<BotAlert[]> {
  const { data, error } = await supabase
    .from("bot_status")
    .select("state, reason, seen_at, portal:job_portals!inner(name)")
    .eq("job_portals.bot_enabled", true);
  if (error) throw toAppError(error);

  const limit = now.getTime() - BOT_SILENCE_MINUTES * 60_000;
  const alerts: BotAlert[] = [];
  for (const row of data ?? []) {
    const portalName = row.portal.name;
    if (row.state === "necesita_persona") {
      alerts.push({ portalName, kind: "necesita_persona", reason: row.reason, seenAt: row.seen_at });
    } else if (new Date(row.seen_at).getTime() < limit) {
      alerts.push({ portalName, kind: "sin_senal", reason: null, seenAt: row.seen_at });
    }
  }
  return alerts;
}
