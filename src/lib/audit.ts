import "server-only";
import { AppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";

/**
 * Registra la descarga de un CV (los disparadores no ven lecturas). La base de
 * datos verifica que el usuario tenga acceso al CV antes de registrarla.
 */
export async function logResumeDownload(supabase: AppSupabaseClient, resumeId: string): Promise<void> {
  const { error } = await supabase.rpc("log_resume_download", { p_resume_id: resumeId });
  if (error) {
    throw new AppError("No se pudo registrar la auditoría de la descarga.", "unavailable");
  }
}
