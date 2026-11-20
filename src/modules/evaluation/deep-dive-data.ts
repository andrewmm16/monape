import "server-only";
import { AppError, toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { pickDeepDiveState, type DeepDiveState } from "./deep-dive";

/** Trabajos recientes que se leen para decidir qué mostrar (uno por solicitud; pocos por postulación). */
const RECENT_JOBS = 20;

/** Preguntas de la IA de la postulación y estado de su cola (respeta la RLS). */
export async function loadDeepDiveState(
  supabase: AppSupabaseClient,
  applicationId: string,
  key: { resumeId: string | null; criteriaVersion: number },
): Promise<DeepDiveState> {
  const { data, error } = await supabase
    .from("interview_deep_dives")
    .select("id, status, origin, error_code, requested_at, available_at, attempts, resume_id, criteria_version, questions, finished_at")
    .eq("application_id", applicationId)
    .order("requested_at", { ascending: false })
    .limit(RECENT_JOBS);
  if (error) throw toAppError(error);
  return pickDeepDiveState(data ?? [], key);
}

/** Botón «Generar preguntas con IA»: encola (o devuelve el trabajo ya abierto). */
export async function requestDeepDive(supabase: AppSupabaseClient, applicationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("request_interview_deep_dive", { p_application_id: applicationId });
  if (error) throw toAppError(error);
  if (!data) throw new AppError("No se pudieron pedir las preguntas a la IA.", "internal");
  return data;
}
