import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export type NotificationItem = {
  id: number;
  kind: Enums<"notification_kind">;
  createdAt: string;
  read: boolean;
  applicationId: string;
  actorName: string | null;
  candidateName: string | null;
  vacancyTitle: string | null;
};

export type NotificationFeed = { items: NotificationItem[]; unread: number };

const FEED_SIZE = 20;

/** Notificaciones del usuario de la sesión (RLS: solo las propias). */
export async function getNotificationFeed(supabase: AppSupabaseClient): Promise<NotificationFeed> {
  const [list, unread] = await Promise.all([
    supabase
      .from("notifications")
      .select(
        "id, kind, created_at, read_at, application_id, actor:profiles!notifications_actor_id_fkey(full_name), application:applications(candidate:candidates(full_name), vacancy:vacancies(title))",
      )
      .order("created_at", { ascending: false })
      .limit(FEED_SIZE),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (list.error) throw toAppError(list.error);
  if (unread.error) throw toAppError(unread.error);

  return {
    unread: unread.count ?? 0,
    items: list.data.map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      read: row.read_at !== null,
      applicationId: row.application_id,
      actorName: row.actor?.full_name ?? null,
      // Si ya no tiene acceso a la postulación (RLS), no se muestran sus datos.
      candidateName: row.application?.candidate?.full_name ?? null,
      vacancyTitle: row.application?.vacancy?.title ?? null,
    })),
  };
}

/** Postulaciones en las que se pidió la opinión del usuario y aún no respondió. */
export async function listPendingOpinions(supabase: AppSupabaseClient, profileId: string) {
  const { data, error } = await supabase
    .from("application_overview")
    .select("id, candidate_name, vacancy_title, opinion_requested_at")
    .eq("assigned_evaluator_id", profileId)
    .not("opinion_requested_at", "is", null)
    .is("opinion_answered_at", null)
    .order("opinion_requested_at", { ascending: true });
  if (error) throw toAppError(error);
  return data;
}
