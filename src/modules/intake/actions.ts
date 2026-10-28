"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, logServerError, toAppError } from "@/lib/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient, type AppSupabaseClient } from "@/lib/supabase/server";
import { evaluateApplication } from "@/modules/evaluation/service";
import { extractResume } from "@/modules/resumes/extraction";
import { sanitizeFileName, validateResumeFile } from "@/modules/resumes/file-validation";
import { RESUMES_BUCKET } from "@/modules/resumes/storage";
import { suggestName } from "@/modules/resumes/suggestions";
import type { Enums, Json } from "@/types/database";
import { intakeStoragePath } from "./paths";
import { registerItemsSchema, startBatchSchema, updateItemSchema, type UpdateItemInput } from "./schemas";
import { registerBatchItem } from "./service";

const ADMITTING_VACANCY_STATUS: string[] = ["borrador", "publicada"];

function resumesBucket() {
  return createSupabaseAdminClient().storage.from(RESUMES_BUCKET);
}

async function requireOpenBatch(supabase: AppSupabaseClient, batchId: string) {
  const { data, error } = await supabase
    .from("intake_batches")
    .select("id, status, vacancy_id, vacancies(criteria_approved_at)")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("El lote no existe o no tiene acceso.", "not_found");
  if (data.status !== "abierto") throw new AppError("El lote ya está cerrado.", "conflict");
  return data;
}

async function findOpenBatchId(supabase: AppSupabaseClient, vacancyId: string, userId: string) {
  const { data, error } = await supabase
    .from("intake_batches")
    .select("id")
    .eq("vacancy_id", vacancyId)
    .eq("created_by", userId)
    .eq("status", "abierto")
    .maybeSingle();
  if (error) throw toAppError(error);
  return data?.id ?? null;
}

/** Abre un lote para la vacante y el portal, o continúa el que ya estaba abierto. */
export async function startBatch(input: { vacancyId: string; portalId: string }): Promise<ActionResult<{ batchId: string }>> {
  return runAction("intake.start_batch", async () => {
    const user = await requirePermission("candidates:manage");
    const values = parseInput(startBatchSchema, input);
    const supabase = await createSupabaseServerClient();

    const existing = await findOpenBatchId(supabase, values.vacancyId, user.id);
    if (existing) return { batchId: existing };

    const { data: vacancy, error: vacancyError } = await supabase
      .from("vacancies")
      .select("status")
      .eq("id", values.vacancyId)
      .maybeSingle();
    if (vacancyError) throw toAppError(vacancyError);
    if (!vacancy) throw new AppError("La vacante no existe o no tiene acceso.", "not_found");
    if (!ADMITTING_VACANCY_STATUS.includes(vacancy.status)) {
      throw new AppError("La vacante no admite nuevas postulaciones.", "conflict");
    }
    const { data: portal, error: portalError } = await supabase
      .from("job_portals")
      .select("id")
      .eq("id", values.portalId)
      .eq("is_active", true)
      .maybeSingle();
    if (portalError) throw toAppError(portalError);
    if (!portal) throw new AppError("El portal no existe o no está activo.", "not_found");

    const { data, error } = await supabase
      .from("intake_batches")
      .insert({ vacancy_id: values.vacancyId, portal_id: values.portalId })
      .select("id")
      .single();
    if (error) {
      // Dos pestañas abriendo a la vez: se continúa el lote que ganó.
      const raced = error.code === "23505" ? await findOpenBatchId(supabase, values.vacancyId, user.id) : null;
      if (raced) return { batchId: raced };
      throw toAppError(error);
    }
    return { batchId: data.id };
  });
}

export type UploadBatchItemResult = {
  itemId: string;
  status: Enums<"intake_item_status">;
  /** Motivo, cuando el archivo quedó con error. */
  message?: string;
};

async function insertErrorItem(
  supabase: AppSupabaseClient,
  batchId: string,
  fileName: string,
  errorCode: string,
  reason: string,
): Promise<UploadBatchItemResult> {
  const { data, error } = await supabase
    .from("intake_batch_items")
    .insert({
      batch_id: batchId,
      status: "error",
      original_filename: sanitizeFileName(fileName),
      error_code: errorCode,
      warnings: [reason],
    })
    .select("id, status")
    .single();
  if (error) throw toAppError(error);
  return { itemId: data.id, status: data.status, message: reason };
}

/**
 * Agrega un archivo al lote: lo valida, calcula su SHA-256, extrae el texto,
 * propone nombre, correo y teléfono, lo guarda en una ruta temporal y crea el
 * ítem. Un archivo inválido crea un ítem con error (sin archivo) y el resto del
 * lote sigue.
 */
export async function uploadBatchItem(formData: FormData): Promise<ActionResult<UploadBatchItemResult>> {
  return runAction("intake.upload_item", async () => {
    await requirePermission("resumes:upload");
    await requirePermission("candidates:manage");
    const batchId = parseInput(z.uuid(), formData.get("batchId"));
    const file = formData.get("file");
    if (!(file instanceof File)) throw new AppError("Seleccione un archivo.", "validation");

    const supabase = await createSupabaseServerClient();
    await enforceRateLimit(supabase, RATE_LIMITS.cvBulkUpload);
    await requireOpenBatch(supabase, batchId);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateResumeFile({ name: file.name, size: file.size, declaredType: file.type, bytes });
    if (!validation.ok) return insertErrorItem(supabase, batchId, file.name, "archivo_invalido", validation.reason);

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { data: repeated, error: repeatedError } = await supabase
      .from("intake_batch_items")
      .select("id")
      .eq("batch_id", batchId)
      .eq("sha256", sha256)
      .maybeSingle();
    if (repeatedError) throw toAppError(repeatedError);
    if (repeated) {
      return insertErrorItem(supabase, batchId, file.name, "duplicado_en_lote", "Este archivo ya está en el lote.");
    }

    // PDF escaneado: se lee con OCR en línea para proponer nombre, correo y teléfono.
    const extraction = await extractResume(bytes, validation.kind, { ocr: "inline" });
    const name = extraction.text ? suggestName(extraction.text) : undefined;
    const suggestedFields = { ...extraction.suggestions, ...(name ? { name } : {}) };

    const itemId = randomUUID();
    const storagePath = intakeStoragePath(batchId, itemId, validation.kind);
    const bucket = resumesBucket();
    const { error: uploadError } = await bucket.upload(storagePath, bytes, {
      contentType: validation.mimeType,
      upsert: false,
      cacheControl: "no-store",
    });
    if (uploadError) {
      logServerError("intake.storage_upload", { code: uploadError.name });
      throw new AppError("No se pudo guardar el archivo. Intente nuevamente.", "unavailable");
    }

    const { data, error } = await supabase
      .from("intake_batch_items")
      .insert({
        id: itemId,
        batch_id: batchId,
        status: "listo",
        original_filename: validation.safeName,
        storage_path: storagePath,
        mime_type: validation.mimeType,
        size_bytes: bytes.length,
        sha256,
        extraction_status: extraction.status,
        extraction_method: extraction.method,
        raw_text: extraction.text,
        suggested_fields: suggestedFields as Json,
        warnings: extraction.warnings,
        error_code: extraction.errorCode,
        // Valores propuestos: RRHH los ve y corrige en la revisión antes de registrar.
        full_name: name?.value.slice(0, 160) ?? null,
        name_from_cv: Boolean(name),
        email: extraction.suggestions.email?.value ?? null,
        phone: extraction.suggestions.phone?.value ?? null,
      })
      .select("id, status")
      .single();
    if (error) {
      // Compensación: no dejar archivos sin ítem.
      const { error: removeError } = await bucket.remove([storagePath]);
      if (removeError) logServerError("intake.orphan", { code: "archivo_huerfano" });
      throw toAppError(error, { conflict: "Este archivo ya está en el lote." });
    }
    return { itemId: data.id, status: data.status };
  });
}

function sameText(a: string, b: string): boolean {
  const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  return plain(a) === plain(b);
}

/** Corrige nombre, correo o teléfono del ítem; el estado se recalcula (listo si hay nombre). */
export async function updateBatchItem(input: UpdateItemInput): Promise<ActionResult<{ status: Enums<"intake_item_status"> }>> {
  return runAction("intake.update_item", async () => {
    await requirePermission("candidates:manage");
    const values = parseInput(updateItemSchema, input);
    const supabase = await createSupabaseServerClient();

    const { data: item, error: itemError } = await supabase
      .from("intake_batch_items")
      .select("id, status, suggested_fields")
      .eq("id", values.itemId)
      .maybeSingle();
    if (itemError) throw toAppError(itemError);
    if (!item) throw new AppError("El archivo no existe o no tiene acceso.", "not_found");
    if (item.status !== "listo" && item.status !== "requiere_datos") {
      throw new AppError("Este archivo ya no se puede editar.", "conflict");
    }

    const suggested = item.suggested_fields as { name?: { value?: string } } | null;
    const proposed = suggested?.name?.value;
    const { data, error } = await supabase
      .from("intake_batch_items")
      .update({
        full_name: values.fullName || null,
        email: values.email || null,
        phone: values.phone || null,
        // «Del CV» solo si RRHH dejó el nombre tal como se extrajo.
        name_from_cv: Boolean(values.fullName && proposed && sameText(values.fullName, proposed)),
      })
      .eq("id", values.itemId)
      .select("status")
      .maybeSingle();
    if (error) throw toAppError(error);
    if (!data) throw new AppError("El archivo no existe o no tiene acceso.", "not_found");
    return { status: data.status };
  });
}

export type RegisterBatchSummary = {
  registered: number;
  evaluated: number;
  /** Registrados cuya evaluación por reglas no pudo ejecutarse. */
  notEvaluated: number;
  errors: { itemId: string; filename: string; message: string }[];
};

/**
 * Registra los ítems elegidos: cada uno mueve su archivo, llama a la función
 * de base de datos y, si los criterios de la vacante están aprobados, ejecuta
 * la evaluación por reglas. El fallo de un ítem no detiene a los demás. En el
 * lote no se aplica el límite `evaluation`.
 */
export async function registerBatchItems(batchId: string, itemIds: string[]): Promise<ActionResult<RegisterBatchSummary>> {
  return runAction("intake.register_items", async () => {
    await requirePermission("candidates:manage");
    await requirePermission("resumes:upload");
    const values = parseInput(registerItemsSchema, { batchId, itemIds });
    const supabase = await createSupabaseServerClient();
    const batch = await requireOpenBatch(supabase, values.batchId);

    const { data: items, error } = await supabase
      .from("intake_batch_items")
      .select("id, status, original_filename, storage_path, extraction_method")
      .eq("batch_id", values.batchId)
      .in("id", values.itemIds);
    if (error) throw toAppError(error);
    const byId = new Map(items.map((item) => [item.id, item]));

    const bucket = resumesBucket();
    const canEvaluate = Boolean(batch.vacancies?.criteria_approved_at);
    const summary: RegisterBatchSummary = { registered: 0, evaluated: 0, notEvaluated: 0, errors: [] };

    for (const itemId of values.itemIds) {
      const item = byId.get(itemId);
      if (!item) {
        summary.errors.push({ itemId, filename: "Archivo desconocido", message: "El archivo no pertenece al lote." });
        continue;
      }
      if (item.status !== "listo") {
        const message =
          item.status === "registrado"
            ? "El archivo ya fue registrado."
            : item.status === "error"
              ? "El archivo tiene un error y no se puede registrar."
              : "Falta el nombre del candidato.";
        summary.errors.push({ itemId, filename: item.original_filename, message });
        continue;
      }
      const outcome = await registerBatchItem(supabase, bucket, item);
      if (!outcome.ok) {
        summary.errors.push({ itemId, filename: item.original_filename, message: outcome.message });
        continue;
      }
      summary.registered += 1;
      if (!canEvaluate) continue;
      try {
        await evaluateApplication(supabase, outcome.applicationId, "reglas");
        summary.evaluated += 1;
      } catch (evaluationError) {
        logServerError("intake.evaluate", evaluationError);
        summary.notEvaluated += 1;
      }
    }

    revalidatePath("/postulaciones");
    revalidatePath(`/vacantes/${batch.vacancy_id}`);
    revalidatePath("/candidatos");
    return summary;
  });
}

/** Descarta un ítem pendiente: borra su archivo y el ítem. */
export async function discardBatchItem(itemId: string): Promise<ActionResult> {
  return runAction("intake.discard_item", async () => {
    await requirePermission("candidates:manage");
    const id = parseInput(z.uuid(), itemId);
    const supabase = await createSupabaseServerClient();

    const { data: item, error } = await supabase
      .from("intake_batch_items")
      .select("id, status, storage_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw toAppError(error);
    if (!item) throw new AppError("El archivo no existe o no tiene acceso.", "not_found");
    if (item.status === "registrado") throw new AppError("Un archivo registrado no se puede descartar.", "conflict");

    // Primero el archivo: si falla, el ítem sigue visible y se puede reintentar.
    if (item.storage_path) {
      const { error: removeError } = await resumesBucket().remove([item.storage_path]);
      if (removeError) {
        logServerError("intake.remove_file", { code: "borrado_fallido" });
        throw new AppError("No se pudo borrar el archivo. Intente nuevamente.", "unavailable");
      }
    }
    const { error: deleteError } = await supabase.from("intake_batch_items").delete().eq("id", id);
    if (deleteError) throw toAppError(deleteError);
    return null;
  });
}

/** Cierra el lote: borra los ítems no registrados con sus archivos. */
export async function closeBatch(batchId: string): Promise<ActionResult> {
  return runAction(
    "intake.close_batch",
    async () => {
      await requirePermission("candidates:manage");
      const id = parseInput(z.uuid(), batchId);
      const supabase = await createSupabaseServerClient();
      await requireOpenBatch(supabase, id);

      // La función cierra el lote y borra los ítems pendientes en una transacción
      // (con el mismo candado que las subidas); devuelve las rutas a borrar.
      const { data: paths, error } = await supabase.rpc("close_intake_batch", { p_batch_id: id });
      if (error) throw toAppError(error);

      if (paths.length > 0) {
        const { error: removeError } = await resumesBucket().remove(paths);
        // El lote ya está cerrado y sus ítems borrados: solo queda registrar el fallo.
        if (removeError) logServerError("intake.orphan", { code: "archivo_huerfano" });
      }
      return null;
    },
    "Lote cerrado.",
  );
}
