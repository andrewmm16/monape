import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

export type PortalPublicationRow = {
  /** `bot_enabled`: el robot ya sabe atender este portal. */
  portal: Pick<Tables<"job_portals">, "id" | "name" | "bot_enabled">;
  publication: Pick<
    Tables<"portal_publications">,
    "id" | "status" | "manual" | "external_id" | "external_url" | "error_code" | "published_at" | "last_synced_at" | "requested_at"
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
      .select("id, portal_id, status, manual, external_id, external_url, error_code, published_at, last_synced_at, requested_at")
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

/** Nivel del semáforo que ve RRHH por cada portal. */
export type BotPortalNivel = "ok" | "atencion" | "error" | "sin_datos";

export type BotPortalStatus = {
  portalName: string;
  nivel: BotPortalNivel;
  /** Código corto de la causa (o `sin_senal` si dejó de dar señales); `null` cuando está bien o no hay datos. */
  reason: string | null;
  seenAt: string | null;
};

/**
 * Causas por las que el robot se detiene que una persona de RRHH resuelve sola
 * (iniciar sesión, reiniciar el robot, esperar a que el portal vuelva). Las
 * demás (el portal cambió su página) necesitan al responsable técnico.
 */
const ATTENTION_REASONS = new Set([
  "sesion_expirada",
  "verificacion_requerida",
  "navegador_cerrado",
  "portal_no_disponible",
  "demasiados_intentos",
  "retiro_fallido",
  "sincronizacion_pendiente",
  "api_no_disponible",
  "publicacion_rechazada",
  "oferta_no_encontrada",
]);

type BotStatusEmbed = { state: string; reason: string | null; seen_at: string } | null;

/** El embebido a-uno puede llegar como objeto o como arreglo según PostgREST. */
function firstStatus(embed: BotStatusEmbed | BotStatusEmbed[]): BotStatusEmbed {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

function classifyPortal(status: BotStatusEmbed, now: Date): Pick<BotPortalStatus, "nivel" | "reason" | "seenAt"> {
  if (!status) return { nivel: "sin_datos", reason: null, seenAt: null };
  if (status.state === "necesita_persona") {
    const nivel: BotPortalNivel = status.reason && ATTENTION_REASONS.has(status.reason) ? "atencion" : "error";
    return { nivel, reason: status.reason, seenAt: status.seen_at };
  }
  // activo
  if (now.getTime() - new Date(status.seen_at).getTime() >= BOT_SILENCE_MINUTES * 60_000) {
    return { nivel: "atencion", reason: "sin_senal", seenAt: status.seen_at };
  }
  return { nivel: "ok", reason: null, seenAt: status.seen_at };
}

/**
 * Estado de TODOS los portales que atiende el robot, para el semáforo del panel.
 * A diferencia de `listBotAlerts`, incluye los que están bien (verde) y los que
 * aún no se han conectado (gris).
 */
export async function listBotPortalStatuses(supabase: AppSupabaseClient, now: Date = new Date()): Promise<BotPortalStatus[]> {
  const { data, error } = await supabase
    .from("job_portals")
    .select("name, bot_status(state, reason, seen_at)")
    .eq("kind", "manual")
    .eq("is_active", true)
    .eq("bot_enabled", true)
    .order("position");
  if (error) throw toAppError(error);
  return (data ?? []).map((row: { name: string; bot_status: BotStatusEmbed | BotStatusEmbed[] }) => ({
    portalName: row.name,
    ...classifyPortal(firstStatus(row.bot_status), now),
  }));
}

export type BotAlert = {
  portalName: string;
  kind: "necesita_persona" | "sin_senal";
  reason: string | null;
  seenAt: string;
};

/**
 * Avisos del robot para RRHH: se detuvo esperando a una persona (una verificación
 * o la sesión vencida) o dejó de dar señales. Un robot que nunca se
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
