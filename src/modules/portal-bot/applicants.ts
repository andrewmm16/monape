import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evaluateApplication } from "@/modules/evaluation/service";
import { resumeStoragePath } from "@/modules/intake/paths";
import { validateResumeBytes } from "@/modules/integrations/talent-apply/resume";
import { extractResume, needsOcr } from "@/modules/resumes/extraction";
import { applyOcrToResume } from "@/modules/resumes/ocr-apply";
import { RESUMES_BUCKET } from "@/modules/resumes/storage";
import type { Json } from "@/types/database";
import { httpStatusOf, json, rejectUnlessBot, type AdminClient } from "./auth";

/** Un CV de 4 MB más los campos de texto. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/** Campos del formulario multipart; el CV viaja aparte, como archivo. */
const fieldsSchema = z.object({
  publicationId: z.uuid(),
  externalId: text(1, 150),
  fullName: text(2, 160),
  // Un correo o teléfono que el portal muestra mal no debe costar el postulante entero: se ignora el dato.
  email: z.string().trim().max(254).regex(EMAIL_PATTERN).optional().catch(undefined),
  phone: z.string().trim().max(40).optional().catch(undefined),
});

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

async function removeUpload(admin: AdminClient, path: string): Promise<void> {
  const { error } = await admin.storage.from(RESUMES_BUCKET).remove([path]);
  if (error) logServerError("bot.orphan", { code: "archivo_huerfano" });
}

/** `true` o `false` si consta en la base de datos; `null` si no se pudo comprobar. */
async function isResumeRegistered(admin: AdminClient, resumeId: string): Promise<boolean | null> {
  const { data, error } = await admin.from("resumes").select("id").eq("id", resumeId).maybeSingle();
  if (error) {
    logServerError("bot.verify_registration", { code: error.code });
    return null;
  }
  return data !== null;
}

/**
 * POST /api/bot/postulantes (multipart/form-data): registra a un postulante que
 * el robot leyó en el portal. Es idempotente por oferta e `externalId`: si ya
 * estaba registrado responde `ya_registrada` sin crear nada. Siempre crea un
 * candidato nuevo; los posibles duplicados quedan señalados, nunca fusionados.
 * Después evalúa con el motor de reglas (y OCR si el PDF es un escaneado).
 */
export async function receiveBotApplicant(request: Request): Promise<Response> {
  const denied = rejectUnlessBot(request);
  if (denied) return denied;

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { error: "cuerpo_demasiado_grande" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "formulario_invalido" });
  }
  const fields = fieldsSchema.safeParse({
    publicationId: field(form, "publicationId"),
    externalId: field(form, "externalId"),
    fullName: field(form, "fullName"),
    email: field(form, "email"),
    phone: field(form, "phone"),
  });
  const file = form.get("resume");
  if (!fields.success || !(file instanceof File)) return json(422, { error: "payload_invalido" });
  if (file.size > MAX_BODY_BYTES) return json(413, { error: "cuerpo_demasiado_grande" });

  const resume = validateResumeBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!resume.ok) return json(422, { error: resume.reason });

  try {
    const admin = createSupabaseAdminClient();

    // Un reenvío (el robot perdió su registro de enviados o la respuesta se cortó) se contesta antes
    // de extraer el texto y subir el archivo. La comprobación definitiva sigue siendo la de la función SQL.
    const { data: prior } = await admin
      .from("integration_submissions")
      .select("application_id")
      .eq("provider", "portal_bot")
      .eq("external_id", `${fields.data.publicationId}:${fields.data.externalId}`)
      .eq("status", "registrada")
      .maybeSingle();
    if (prior?.application_id) return json(200, { status: "ya_registrada", applicationId: prior.application_id });

    const sha256 = createHash("sha256").update(resume.bytes).digest("hex");
    const extraction = await extractResume(resume.bytes, resume.kind);
    const candidateId = randomUUID();
    const resumeId = randomUUID();
    const storagePath = resumeStoragePath(candidateId, resumeId, resume.kind);

    const { error: uploadError } = await admin.storage.from(RESUMES_BUCKET).upload(storagePath, resume.bytes, {
      contentType: resume.mimeType,
      upsert: false,
      cacheControl: "no-store",
    });
    if (uploadError) {
      logServerError("bot.storage_upload", { code: uploadError.name });
      return json(500, { error: "error_interno" });
    }

    const { data, error } = await admin.rpc("register_bot_application", {
      p_publication_id: fields.data.publicationId,
      p_external_id: fields.data.externalId,
      p_candidate_id: candidateId,
      p_resume_id: resumeId,
      p_storage_path: storagePath,
      p_full_name: fields.data.fullName,
      p_email: fields.data.email ?? null,
      p_phone: fields.data.phone ?? null,
      p_original_filename: resume.filename,
      p_mime_type: resume.mimeType,
      p_size_bytes: resume.bytes.length,
      p_sha256: sha256,
      p_extraction_status: extraction.status,
      p_extraction_method: extraction.method,
      p_extractor_version: extraction.extractorVersion,
      p_raw_text: extraction.text,
      p_suggested_fields: extraction.suggestions as unknown as Json,
      p_warnings: extraction.warnings,
      p_error_code: extraction.status === "fallida" ? extraction.errorCode : null,
    });
    const result = data?.[0];
    if (error || !result?.application_id) {
      // Si el registro se confirmó pero la respuesta se perdió, el CV ya está
      // referenciado: no se borra. Solo se borra cuando consta que no quedó registrado.
      const committed = await isResumeRegistered(admin, resumeId);
      if (committed === true) return json(200, { status: "ok" });
      if (committed === false) await removeUpload(admin, storagePath);
      throw error ?? new Error("registro_sin_resultado");
    }
    if (result.already_registered) {
      await removeUpload(admin, storagePath);
      return json(200, { status: "ya_registrada", applicationId: result.application_id });
    }

    const applicationId = result.application_id;
    const evaluate = async () => {
      try {
        await evaluateApplication(admin, applicationId, "reglas", { system: true });
      } catch (evaluationError) {
        logServerError("bot.evaluate", evaluationError);
      }
    };
    if (needsOcr(extraction)) {
      // PDF escaneado: OCR y evaluación después de responder (el OCR es lento).
      const bytes = resume.bytes;
      after(async () => {
        try {
          await applyOcrToResume(admin, resumeId, bytes);
        } catch (ocrError) {
          logServerError("bot.ocr", ocrError);
        }
        await evaluate();
      });
    } else {
      await evaluate();
    }
    return json(200, { status: "registrada", applicationId });
  } catch (error) {
    logServerError("bot.applicant", error);
    const status = httpStatusOf(error);
    return json(status, { error: status === 500 ? "error_interno" : "solicitud_rechazada" });
  }
}
