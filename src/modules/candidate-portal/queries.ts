import "server-only";
import { logServerError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/** ¿Está encendido el portal del candidato? (si no se puede leer, se trata como apagado). */
export async function isCandidatePortalEnabled(supabase: AppSupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.from("candidate_portal_settings").select("enabled").maybeSingle();
  if (error) {
    logServerError("candidate_portal.settings", error);
    return false;
  }
  return Boolean(data?.enabled);
}

export const PORTAL_STAGES = ["recibida", "en_revision", "entrevista", "evaluacion_final", "seleccionado", "finalizado"] as const;
export type PortalStage = (typeof PORTAL_STAGES)[number];

export type PublicApplicationStatus = {
  vacancyTitle: string;
  stage: PortalStage;
  appliedAt: string | null;
  updatedAt: string | null;
  nextInterview: {
    scheduledAt: string;
    durationMinutes: number;
    modality: Enums<"interview_modality">;
    location: string | null;
  } | null;
};

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Lo que ve la persona candidata con su enlace (cliente de servicio). Null si no corresponde mostrar nada. */
export async function getPublicApplicationStatus(admin: AppSupabaseClient, token: string): Promise<PublicApplicationStatus | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await admin.rpc("public_application_status", { p_token: token });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  const stage = PORTAL_STAGES.find((value) => value === row.stage) ?? "finalizado";
  const interview = row.next_interview as Record<string, unknown> | null;
  return {
    vacancyTitle: typeof row.vacancy_title === "string" ? row.vacancy_title : "Vacante",
    stage,
    appliedAt: typeof row.applied_at === "string" ? row.applied_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    nextInterview:
      interview && typeof interview.scheduled_at === "string"
        ? {
            scheduledAt: interview.scheduled_at,
            durationMinutes: Number(interview.duration_minutes ?? 45),
            modality: interview.modality as Enums<"interview_modality">,
            location: typeof interview.location === "string" ? interview.location : null,
          }
        : null,
  };
}
