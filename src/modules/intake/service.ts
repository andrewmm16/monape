import "server-only";
import { randomUUID } from "node:crypto";
import { logServerError, toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { EXTRACTOR_VERSION } from "@/modules/resumes/extraction";
import { OCR_LOCAL_EXTRACTOR_VERSION } from "@/modules/resumes/ocr/types";
import { kindFromPath, resumeStoragePath } from "./paths";

/** Parte de la API de Storage que usa el registro (permite probarlo sin red). */
export type ResumeBucket = {
  move(from: string, to: string): Promise<{ error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
};

export type RegisterItemOutcome =
  | { ok: true; applicationId: string }
  | { ok: false; message: string };

/**
 * Compensación tras un error de la función. Se consulta el estado real del
 * ítem, porque el error puede ser una respuesta perdida tras un commit o un
 * lote cerrado mientras tanto.
 */
async function compensate(
  supabase: AppSupabaseClient,
  bucket: ResumeBucket,
  itemId: string,
  temporaryPath: string,
  finalPath: string,
): Promise<void> {
  const { data: current, error } = await supabase
    .from("intake_batch_items")
    .select("status")
    .eq("id", itemId)
    .maybeSingle();

  if (!error && current?.status === "registrado") {
    // El registro sí se confirmó: el archivo ya está donde corresponde.
    logServerError("intake.registered_after_error", { code: "registrado_tras_error" });
    return;
  }
  if (!error && !current) {
    // El lote se cerró y el ítem se borró: el archivo no debe quedar en Storage.
    const { error: removeError } = await bucket.remove([finalPath]);
    if (removeError) logServerError("intake.orphan", { code: "archivo_huerfano" });
    return;
  }
  // El archivo vuelve a su lugar para poder reintentar o descartar.
  const { error: restoreError } = await bucket.move(finalPath, temporaryPath);
  if (restoreError) logServerError("intake.orphan", { code: "archivo_huerfano" });
}

/**
 * Registra un ítem del lote. La restricción resumes_storage_path_check exige
 * rutas candidates/{id}/…: se generan los identificadores, se MUEVE el archivo
 * a su ruta definitiva y solo entonces se llama a la función de base de datos.
 * Si la función falla, el archivo vuelve a la ruta temporal (compensación).
 */
export async function registerBatchItem(
  supabase: AppSupabaseClient,
  bucket: ResumeBucket,
  item: { id: string; storage_path: string | null; extraction_method?: string | null },
): Promise<RegisterItemOutcome> {
  const kind = item.storage_path ? kindFromPath(item.storage_path) : null;
  if (!item.storage_path || !kind) return { ok: false, message: "El archivo del lote no está disponible." };

  const temporaryPath = item.storage_path;
  const candidateId = randomUUID();
  const resumeId = randomUUID();
  const finalPath = resumeStoragePath(candidateId, resumeId, kind);

  const { error: moveError } = await bucket.move(temporaryPath, finalPath);
  if (moveError) {
    logServerError("intake.move", { code: "mover_fallido" });
    return { ok: false, message: "No se pudo preparar el archivo. Intente nuevamente." };
  }

  const { data, error } = await supabase.rpc("register_batch_item", {
    p_item_id: item.id,
    p_candidate_id: candidateId,
    p_resume_id: resumeId,
    p_storage_path: finalPath,
    p_extractor_version: item.extraction_method === "pdf_ocr" ? OCR_LOCAL_EXTRACTOR_VERSION : EXTRACTOR_VERSION,
  });
  if (error || !data) {
    await compensate(supabase, bucket, item.id, temporaryPath, finalPath);
    return { ok: false, message: toAppError(error).message };
  }
  return { ok: true, applicationId: data };
}
