"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, logServerError, toAppError } from "@/lib/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { extractResume } from "./extraction";
import { validateResumeFile } from "./file-validation";
import { applyOcrToResume, describeOcrResult } from "./ocr-apply";
import { RESUMES_BUCKET } from "./storage";

export type UploadResumeResult = { resumeId: string; version: number; extractionStatus: string };

/**
 * Carga un CV: valida el archivo, extrae el texto, lo guarda en el bucket
 * privado y registra la versión con su extracción en una transacción. El
 * archivo nunca se ejecuta ni se publica.
 */
export async function uploadResume(formData: FormData): Promise<ActionResult<UploadResumeResult>> {
  return runAction("resumes.upload", async () => {
    await requirePermission("resumes:upload");
    const candidateId = parseInput(z.uuid(), formData.get("candidateId"));
    const file = formData.get("file");
    if (!(file instanceof File)) throw new AppError("Seleccione un archivo.", "validation");

    const supabase = await createSupabaseServerClient();
    await enforceRateLimit(supabase, RATE_LIMITS.cvUpload);

    const { data: candidate, error: candidateError } = await supabase
      .from("candidates")
      .select("id")
      .eq("id", candidateId)
      .maybeSingle();
    if (candidateError) throw toAppError(candidateError);
    if (!candidate) throw new AppError("El candidato no existe o no tiene acceso.", "not_found");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateResumeFile({ name: file.name, size: file.size, declaredType: file.type, bytes });
    if (!validation.ok) throw new AppError(validation.reason, "validation");

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { data: existing } = await supabase
      .from("resumes")
      .select("version")
      .eq("candidate_id", candidateId)
      .eq("sha256", sha256)
      .maybeSingle();
    if (existing) {
      throw new AppError(`Este archivo ya fue cargado como versión ${existing.version}.`, "conflict");
    }

    // Extracción antes de escribir nada: es local y no depende del almacenamiento.
    const extraction = await extractResume(bytes, validation.kind, { ocr: "inline" });

    // El almacenamiento solo lo accede el servidor (ver migración 0005).
    const storage = createSupabaseAdminClient().storage.from(RESUMES_BUCKET);
    const resumeId = randomUUID();
    const storagePath = `candidates/${candidateId}/${resumeId}.${validation.kind}`;
    const { error: uploadError } = await storage.upload(storagePath, bytes, {
      contentType: validation.mimeType,
      upsert: false,
      cacheControl: "no-store",
    });
    if (uploadError) {
      logServerError("resumes.storage_upload", { code: uploadError.name });
      throw new AppError("No se pudo guardar el archivo. Intente nuevamente.", "unavailable");
    }

    // CV + extracción en una sola transacción, con la sesión del usuario.
    const { data: version, error: registerError } = await supabase.rpc("register_resume", {
      p_resume_id: resumeId,
      p_candidate_id: candidateId,
      p_storage_path: storagePath,
      p_original_filename: validation.safeName,
      p_mime_type: validation.mimeType,
      p_size_bytes: bytes.length,
      p_sha256: sha256,
      p_extraction_status: extraction.status,
      p_extraction_method: extraction.method,
      p_extractor_version: extraction.extractorVersion,
      p_raw_text: extraction.text,
      p_suggested_fields: extraction.suggestions as Json,
      p_warnings: extraction.warnings,
      p_error_code: extraction.errorCode,
    });
    if (registerError || version === null) {
      // Compensación: no dejar archivos sin registro.
      const { error: removeError } = await storage.remove([storagePath]);
      if (removeError) logServerError("resumes.orphan", { code: "archivo_huerfano" });
      throw toAppError(registerError);
    }

    revalidatePath(`/candidatos/${candidateId}`);
    return { resumeId, version, extractionStatus: extraction.status };
  });
}

/**
 * Lee con OCR local un CV en PDF sin texto legible (botón «Leer escaneo
 * automáticamente»). El acceso se comprueba con la sesión del usuario; el
 * archivo se descarga con el cliente de administración y el resultado se
 * guarda con la sesión del usuario. No evalúa ni pisa un texto corregido.
 */
export async function readScannedResume(resumeId: string): Promise<ActionResult<{ status: "completada" | "sin_texto"; failed: boolean }>> {
  const result = await runAction("resumes.ocr", async () => {
    await requirePermission("resumes:upload");
    const id = parseInput(z.uuid(), resumeId);
    const supabase = await createSupabaseServerClient();

    const { data: resume, error } = await supabase
      .from("resumes")
      .select("id, candidate_id, storage_path, mime_type, resume_extractions(status, method, corrected_text)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw toAppError(error);
    if (!resume) throw new AppError("El CV no existe o no tiene acceso.", "not_found");
    const extraction = resume.resume_extractions;
    if (resume.mime_type !== "application/pdf" || !extraction) {
      throw new AppError("Solo se puede leer automáticamente un CV en PDF.", "conflict");
    }
    if (extraction.corrected_text) {
      throw new AppError("El CV ya tiene un texto corregido por RRHH.", "conflict");
    }
    if (extraction.status !== "sin_texto") {
      throw new AppError("El CV ya tiene texto legible.", "conflict");
    }

    // El límite se consume al final, justo antes del OCR, para no gastarlo en solicitudes inválidas.
    await enforceRateLimit(supabase, RATE_LIMITS.cvOcr);

    const { data: file, error: downloadError } = await createSupabaseAdminClient()
      .storage.from(RESUMES_BUCKET)
      .download(resume.storage_path);
    if (downloadError || !file) {
      logServerError("resumes.ocr_download", { code: downloadError?.name ?? "sin-archivo" });
      throw new AppError("No se pudo abrir el archivo. Intente nuevamente.", "unavailable");
    }
    const result = await applyOcrToResume(supabase, resume.id, new Uint8Array(await file.arrayBuffer()));
    if (!result.attempted) {
      throw new AppError("La lectura automática no está disponible en este momento. Intente más tarde.", "unavailable");
    }
    if (!result.applied) throw new AppError("El CV cambió mientras se leía. Actualice la página.", "conflict");
    revalidatePath(`/candidatos/${resume.candidate_id}`);
    return { status: result.status, failed: result.failed };
  });
  return result.ok ? { ...result, message: describeOcrResult(result.data) } : result;
}

const correctionSchema = z.object({
  candidateId: z.uuid(),
  extractionId: z.uuid(),
  text: z.string().max(200_000, "Máximo 200 000 caracteres"),
});

/** Guarda el texto corregido o transcrito manualmente por RRHH. */
export async function saveCorrectedText(input: z.input<typeof correctionSchema>): Promise<ActionResult> {
  return runAction(
    "resumes.correct_text",
    async () => {
      await requirePermission("candidates:manage");
      const values = parseInput(correctionSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data: owner, error: ownerError } = await supabase
        .from("resume_extractions")
        .select("resumes!inner(candidate_id)")
        .eq("id", values.extractionId)
        .maybeSingle();
      if (ownerError) throw toAppError(ownerError);
      if (!owner || owner.resumes.candidate_id !== values.candidateId) {
        throw new AppError("La extracción no corresponde al candidato.", "not_found");
      }
      const text = values.text.trim();
      const { data, error } = await supabase
        .from("resume_extractions")
        .update({ corrected_text: text === "" ? null : text })
        .eq("id", values.extractionId)
        .select("id");
      if (error) throw toAppError(error);
      if (!data.length) throw new AppError("La extracción no existe o no tiene acceso.", "not_found");
      revalidatePath(`/candidatos/${values.candidateId}`);
      return null;
    },
    "Texto guardado. Las próximas evaluaciones usarán el texto corregido.",
  );
}
