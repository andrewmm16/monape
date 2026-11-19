import { z } from "zod";
import { AppError, logServerError } from "@/lib/errors";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { intakeStoragePath, resumeStoragePath } from "@/modules/intake/paths";
import { sanitizeFileName } from "./file-validation";
import { RESUMES_BUCKET } from "./storage";
import {
  directMimeType,
  MAX_RESUME_UPLOAD_BYTES,
  maxResumeSizeMessage,
  resumeKindFromName,
  type DirectResumeKind,
  type DirectUploadTarget,
} from "./upload-limits";

/**
 * Carga directa a Storage (CV de más de 4 MB). El servidor autoriza, decide la
 * ruta y firma una URL de un solo uso; el navegador sube el archivo; otra acción
 * lo descarga y aplica las mismas validaciones de siempre. Aquí viven las piezas
 * comunes a la carga interna (ficha y lote) y al formulario público.
 */

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

const uploadRequestSchema = z.object({
  fileName: z.string().trim().min(1, "Seleccione un archivo.").max(255, "El nombre del archivo es demasiado largo."),
  size: z.number().int("Tamaño no válido.").min(1, "El archivo está vacío."),
});

export type DirectUploadRequest =
  | { ok: true; kind: DirectResumeKind; mimeType: string; safeName: string; size: number }
  | { ok: false; reason: string };

/**
 * Valida lo que el navegador DECLARA antes de firmar nada (nombre y tamaño).
 * No es la validación real: esa ocurre sobre los bytes descargados.
 */
export function parseDirectUploadRequest(input: { fileName: unknown; size: unknown }): DirectUploadRequest {
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? "Archivo no válido." };
  const { fileName, size } = parsed.data;
  if (size > MAX_RESUME_UPLOAD_BYTES) return { ok: false, reason: maxResumeSizeMessage(MAX_RESUME_UPLOAD_BYTES) };
  const kind = resumeKindFromName(fileName);
  if (!kind) return { ok: false, reason: "Solo se aceptan archivos PDF o DOCX." };
  return { ok: true, kind, mimeType: directMimeType(kind), safeName: sanitizeFileName(fileName), size };
}

const kindSchema = z.enum(["pdf", "docx"]);

/** Identificadores que vuelven del navegador en la confirmación: solo UUID y extensión conocida. */
export const confirmResumeUploadSchema = z.object({
  candidateId: z.uuid(),
  resumeId: z.uuid(),
  kind: kindSchema,
  fileName: z.string().trim().min(1).max(255),
});

export const confirmBatchUploadSchema = z.object({
  batchId: z.uuid(),
  itemId: z.uuid(),
  kind: kindSchema,
  fileName: z.string().trim().min(1).max(255),
});

/** Nombre para validar: el del navegador si su extensión coincide con la ruta firmada; si no, el nombre con la extensión de la ruta. */
export function nameForConfirmedUpload(fileName: string, kind: DirectResumeKind): string {
  if (resumeKindFromName(fileName) === kind) return fileName;
  const base = fileName.split(/[\\/]/).pop() ?? "cv";
  return `${base.replace(/\.[^.]*$/, "") || "cv"}.${kind}`;
}

/** Ruta que el servidor decide para la ficha del candidato (la misma que exige la base de datos). */
export function directResumePath(candidateId: string, resumeId: string, kind: DirectResumeKind): string {
  return resumeStoragePath(candidateId, resumeId, kind);
}

/** Ruta temporal que el servidor decide para un archivo de la carga masiva. */
export function directBatchPath(batchId: string, itemId: string, kind: DirectResumeKind): string {
  return intakeStoragePath(batchId, itemId, kind);
}

/** Firma una URL de carga de un solo uso (sin `upsert`: no sobrescribe) en la ruta indicada. */
export async function createDirectUploadTarget(
  admin: AdminClient,
  path: string,
  kind: DirectResumeKind,
): Promise<DirectUploadTarget> {
  const { data, error } = await admin.storage.from(RESUMES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    logServerError("resumes.signed_upload", { code: error?.name ?? "sin-url" });
    throw new AppError("No se pudo preparar la carga del archivo. Intente nuevamente.", "unavailable");
  }
  return { signedUrl: data.signedUrl, contentType: directMimeType(kind) };
}

/** Descarga el archivo subido; null si no existe o no se pudo leer. Nunca se ejecuta. */
export async function downloadStagedResume(admin: AdminClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(RESUMES_BUCKET).download(path);
  if (error || !data) {
    if (error) logServerError("resumes.staged_download", { code: error.name });
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** Borra el objeto subido y no registrado; un fallo solo se anota (la limpieza diaria lo recoge). */
export async function removeStagedResume(admin: AdminClient, path: string): Promise<void> {
  const { error } = await admin.storage.from(RESUMES_BUCKET).remove([path]);
  if (error) logServerError("resumes.orphan", { code: "archivo_huerfano" });
}

export const MISSING_UPLOAD_MESSAGE = "No se recibió el archivo. Seleccione el CV e inténtelo nuevamente.";
