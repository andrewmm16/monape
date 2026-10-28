import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import { extractScannedResume } from "./extraction";
import type { OcrRecognizeOptions } from "./ocr/types";

export type OcrApplyResult =
  | { attempted: false }
  | { attempted: true; applied: boolean; status: "completada" | "sin_texto"; failed: boolean };

/** Mensaje para la persona según el resultado de una lectura manual aplicada. */
export function describeOcrResult(result: { status: "completada" | "sin_texto"; failed: boolean }): string {
  if (result.status === "completada") return "Lectura terminada. Revise el texto antes de decidir.";
  if (result.failed) return "No se pudo leer el escaneo automáticamente. Puede transcribir el contenido manualmente.";
  return "El reconocimiento no encontró texto útil; puede transcribirlo.";
}

/**
 * Lee con OCR un CV en PDF ya registrado (extracción `pdf_text` + `sin_texto`)
 * y guarda el resultado con `apply_resume_ocr`, que nunca pisa un texto
 * corregido por RRHH. Sirve tanto con el cliente del usuario como con el de
 * administración (flujos sin sesión). Si el OCR no pudo intentarse (sin motor o
 * ocupado) no cambia nada y devuelve `attempted: false`.
 */
export async function applyOcrToResume(
  supabase: AppSupabaseClient | SupabaseClient<Database>,
  resumeId: string,
  bytes: Uint8Array,
  options: OcrRecognizeOptions = {},
): Promise<OcrApplyResult> {
  const outcome = await extractScannedResume(bytes, options);
  if (!outcome || outcome.status === "fallida") return { attempted: false };
  const { data, error } = await supabase.rpc("apply_resume_ocr", {
    p_resume_id: resumeId,
    p_status: outcome.status,
    p_extractor_version: outcome.extractorVersion,
    p_raw_text: outcome.text,
    p_suggested_fields: outcome.suggestions as unknown as Json,
    p_warnings: outcome.warnings,
    p_error_code: outcome.errorCode,
  });
  if (error) throw toAppError(error);
  return { attempted: true, applied: data === true, status: outcome.status, failed: outcome.errorCode !== null };
}
