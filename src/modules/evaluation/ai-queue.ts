import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { AppError, logServerError, toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/types/database";
import { getAiAvailability } from "./ai/availability";
import { isDoubtful } from "./ai/doubtful";
import type { EvaluationResult, RequirementInput } from "./types";

type AnyClient = AppSupabaseClient | SupabaseClient<Database>;

export type AiJob = Pick<
  Tables<"ai_evaluation_jobs">,
  "id" | "status" | "origin" | "requested_at" | "available_at" | "attempts" | "error_code" | "finished_at"
>;

/** Motivos de espera o de error, en palabras de RRHH (sin detalles internos). */
export const AI_JOB_ERROR_LABELS: Record<string, string> = {
  limite_plan: "se alcanzó el límite de uso del plan de IA",
  sin_sesion: "el servicio de IA perdió su sesión y debe volver a iniciarla",
  worker_no_disponible: "el servicio de IA no está disponible",
  sin_texto: "el CV no tiene texto legible",
  criterios_no_aprobados: "los criterios de la vacante no están aprobados",
  sin_requisitos: "la vacante no tiene requisitos",
  postulacion_no_encontrada: "la postulación ya no existe",
  respuesta_invalida: "la respuesta del modelo no fue válida",
  registro_rechazado: "los datos de la postulación cambiaron mientras se evaluaba",
  rechazo: "el modelo declinó evaluar este CV",
  demasiados_intentos: "se agotaron los reintentos",
  cli_timeout: "el modelo tardó demasiado en responder",
};

export function describeAiJobError(code: string | null): string {
  return (code && AI_JOB_ERROR_LABELS[code]) || "falló el servicio de IA";
}

/** Solicitud manual («Evaluar con IA»): encola la postulación (o devuelve el trabajo ya abierto). */
export async function requestAiEvaluation(supabase: AppSupabaseClient, applicationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("request_ai_evaluation", { p_application_id: applicationId });
  if (error) throw toAppError(error);
  if (!data) throw new AppError("No se pudo encolar la evaluación con IA.", "internal");
  return data;
}

/**
 * Tras una evaluación del motor: encola la segunda opinión con IA según
 * AI_AUTO_ENQUEUE (solo con la cola habilitada). Nunca hace fallar la
 * evaluación del motor: un error se registra y se sigue.
 */
export async function autoEnqueueAfterRules(
  supabase: AnyClient,
  input: {
    applicationId: string;
    result: Pick<EvaluationResult, "level" | "scores" | "items">;
    requirements: Pick<RequirementInput, "id" | "priority">[];
    system?: boolean;
  },
): Promise<void> {
  try {
    const env = getServerEnv();
    const availability = getAiAvailability(env);
    if (!availability.available || !availability.queued || env.AI_AUTO_ENQUEUE === "off") return;
    if (env.AI_AUTO_ENQUEUE === "dudosos" && !isDoubtful(input.result, input.requirements)) return;

    const { error } = input.system
      ? await supabase.rpc("enqueue_system_ai_evaluation", { p_application_id: input.applicationId })
      : await supabase.rpc("request_ai_evaluation", { p_application_id: input.applicationId, p_automatic: true });
    if (error) throw error;
  } catch (error) {
    logServerError("evaluations.ai_auto_enqueue", error);
  }
}

/**
 * Texto para RRHH sobre el último trabajo de IA, o null si no hay nada que
 * mostrar (sin trabajos, o el último terminó bien: su resultado ya está en el
 * historial de evaluaciones). `formatTime` formatea fecha y hora.
 */
export function describeAiJob(
  job: AiJob | null,
  formatTime: (iso: string) => string,
): { message: string; tone: "info" | "warning"; active: boolean } | null {
  if (!job || job.status === "completado") return null;
  if (job.status === "procesando") {
    return { message: "La IA está analizando el CV. El resultado aparecerá aquí.", tone: "info", active: true };
  }
  if (job.status === "error") {
    return {
      message: `La evaluación con IA no se completó: ${describeAiJobError(job.error_code)}. Puede volver a solicitarla.`,
      tone: "warning",
      active: false,
    };
  }
  if (job.error_code === "limite_plan" || job.error_code === "sin_sesion" || job.error_code === "worker_no_disponible") {
    return {
      message: `Evaluación con IA en espera: ${describeAiJobError(job.error_code)}. Se reintentará hacia las ${formatTime(job.available_at)}.`,
      tone: "warning",
      active: true,
    };
  }
  return {
    message:
      job.attempts > 0 && job.error_code
        ? `Evaluación con IA en cola (reintento tras: ${describeAiJobError(job.error_code)}).`
        : `Evaluación con IA en cola desde ${formatTime(job.requested_at)}.`,
    tone: "info",
    active: true,
  };
}

export type AiWorkerStatus = Pick<
  Tables<"ai_worker_status">,
  "state" | "pause_reason" | "paused_until" | "last_seen_at" | "state_since"
>;

/** Sin latidos en este tiempo, el worker se considera desconectado (late cada minuto como máximo). */
export const AI_WORKER_OFFLINE_MS = 3 * 60 * 1_000;

/** Estado del worker de IA (visible para el personal), o null si nunca se conectó. */
export async function getAiWorkerStatus(supabase: AppSupabaseClient): Promise<AiWorkerStatus | null> {
  const { data, error } = await supabase
    .from("ai_worker_status")
    .select("state, pause_reason, paused_until, last_seen_at, state_since")
    .maybeSingle();
  if (error) throw toAppError(error);
  return data;
}

/** Evaluaciones con IA en cola o en proceso (todas las visibles para el usuario). */
export async function countOpenAiJobs(supabase: AppSupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("ai_evaluation_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", ["pendiente", "procesando"]);
  if (error) throw toAppError(error);
  return count ?? 0;
}

/**
 * Aviso para RRHH si el worker no está atendiendo la cola, o null si está bien.
 * `formatTime` formatea fecha y hora.
 */
export function describeAiWorker(
  status: AiWorkerStatus | null,
  formatTime: (iso: string) => string,
  now: number = Date.now(),
): { message: string; needsAdmin: boolean } | null {
  if (!status) {
    return { message: "El servicio de IA todavía no se ha conectado: las evaluaciones con IA quedan en cola.", needsAdmin: true };
  }
  if (now - Date.parse(status.last_seen_at) > AI_WORKER_OFFLINE_MS) {
    return {
      message: `El servicio de IA no responde desde ${formatTime(status.last_seen_at)}. Las evaluaciones con IA quedan en cola y se harán cuando vuelva.`,
      needsAdmin: true,
    };
  }
  if (status.state !== "pausado") return null;
  if (status.pause_reason === "limite_plan") {
    return {
      message: status.paused_until
        ? `Se alcanzó el límite de uso del plan de IA. Las evaluaciones se reanudan hacia las ${formatTime(status.paused_until)}.`
        : "Se alcanzó el límite de uso del plan de IA. Las evaluaciones se reanudarán solas.",
      needsAdmin: false,
    };
  }
  return {
    message:
      status.pause_reason === "sin_sesion"
        ? "El servicio de IA está en pausa: hay que renovar su sesión de Claude. Avise a administración."
        : "El servicio de IA está en pausa: no encuentra el programa de Claude en su equipo. Avise a administración.",
    needsAdmin: true,
  };
}

/** Último trabajo de IA de la postulación (visible según RLS), o null. */
export async function getLatestAiJob(supabase: AppSupabaseClient, applicationId: string): Promise<AiJob | null> {
  const { data, error } = await supabase
    .from("ai_evaluation_jobs")
    .select("id, status, origin, requested_at, available_at, attempts, error_code, finished_at")
    .eq("application_id", applicationId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data;
}
