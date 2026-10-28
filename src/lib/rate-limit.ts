import "server-only";
import { AppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";

/**
 * Operaciones con límite por usuario. Los máximos y las ventanas se definen en
 * la base de datos (función consume_rate_limit), no aquí, para que no puedan
 * alterarse llamando a la función directamente:
 *   cv_upload 20/10 min · cv_download 60/10 min · evaluation 30/10 min ·
 *   ai_evaluation 10/10 min · user_invite 10/h · cv_bulk_upload 100/10 min ·
 *   evaluation_bulk 40/10 min (cada llamada evalúa hasta 25 postulaciones) ·
 *   cv_ocr 20/10 min (lectura manual de escaneados)
 */
export const RATE_LIMITS = {
  cvUpload: "cv_upload",
  cvDownload: "cv_download",
  evaluation: "evaluation",
  aiEvaluation: "ai_evaluation",
  userInvite: "user_invite",
  cvBulkUpload: "cv_bulk_upload",
  evaluationBulk: "evaluation_bulk",
  cvOcr: "cv_ocr",
} as const;

export async function enforceRateLimit(
  supabase: AppSupabaseClient,
  bucket: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS],
): Promise<void> {
  const { data, error } = await supabase.rpc("consume_rate_limit", { p_bucket: bucket });
  if (error) {
    throw new AppError("No se pudo verificar el límite de solicitudes.", "unavailable");
  }
  if (data !== true) {
    throw new AppError("Demasiadas solicitudes. Espere unos minutos e intente nuevamente.", "rate_limited");
  }
}
