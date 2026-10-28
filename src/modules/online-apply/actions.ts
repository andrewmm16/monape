"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evaluateApplication } from "@/modules/evaluation/service";
import { resumeStoragePath } from "@/modules/intake/paths";
import { sniffResumeKind } from "@/modules/integrations/talent-apply/resume";
import { getCurrentPrivacyNotice } from "@/modules/privacy/queries";
import { getPublicVacancy } from "@/modules/public-jobs/queries";
import { extractResume, needsOcr } from "@/modules/resumes/extraction";
import { applyOcrToResume } from "@/modules/resumes/ocr-apply";
import { MAX_RESUME_BYTES, validateResumeFile } from "@/modules/resumes/file-validation";
import { RESUMES_BUCKET } from "@/modules/resumes/storage";
import type { Json } from "@/types/database";
import { verifyChallenge } from "./challenge";
import { getOnlineApplyConfig } from "./config";
import { portalFromReferrer } from "./origin";
import { checkboxValue, onlineApplicationSchema, textValue } from "./schema";
import { rateLimitSubject } from "./subject";
import { MESSAGES, type SubmitApplicationResult } from "./types";

const VACANCY_CODE = /^[a-z0-9]{10}$/;
const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Referencia con el mismo formato que las reales (para el campo trampa). */
function fakeReference(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % 32]).join("");
}

async function removeUpload(admin: AdminClient, path: string): Promise<void> {
  const { error } = await admin.storage.from(RESUMES_BUCKET).remove([path]);
  if (error) logServerError("online_apply.orphan", { code: "archivo_huerfano" });
}

/** `true` o `false` si consta en la base de datos; `null` si no se pudo comprobar. */
async function isResumeRegistered(admin: AdminClient, resumeId: string): Promise<boolean | null> {
  const { data, error } = await admin.from("resumes").select("id").eq("id", resumeId).maybeSingle();
  if (error) {
    logServerError("online_apply.verify_registration", { code: error.code });
    return null;
  }
  return data !== null;
}

/**
 * Evaluación (y, si el PDF quedó sin texto, antes el OCR) después de responder.
 * El OCR usa los bytes que ya están en memoria y guarda el texto con el cliente
 * de administración; si falla, la evaluación sigue como siempre.
 */
function scheduleEvaluation(
  admin: AdminClient,
  applicationId: string,
  ocr?: { resumeId: string; bytes: Uint8Array },
): void {
  after(async () => {
    if (ocr) {
      try {
        await applyOcrToResume(admin, ocr.resumeId, ocr.bytes);
      } catch (error) {
        logServerError("online_apply.ocr", error);
      }
    }
    try {
      await evaluateApplication(admin, applicationId, "reglas", { system: true });
    } catch (error) {
      // Sin datos personales: solo el tipo y el código del error.
      logServerError("online_apply.evaluate", error);
    }
  });
}

function fail(message: string, extra: Partial<Extract<SubmitApplicationResult, { ok: false }>> = {}): SubmitApplicationResult {
  return { ok: false, message, ...extra };
}

/**
 * Comprobación barata del CV, sin análisis estructural: tamaño, extensión y
 * firma del contenido (bytes mágicos). Devuelve el mensaje o null.
 */
function cheapResumeCheck(file: File, bytes: Uint8Array): string | null {
  if (file.size > MAX_RESUME_BYTES || bytes.length > MAX_RESUME_BYTES) return "El archivo supera el tamaño máximo de 4 MB.";
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "pdf" && extension !== "docx") return "Solo se aceptan archivos PDF o DOCX.";
  if (sniffResumeKind(bytes) !== extension) {
    return extension === "pdf" ? "El archivo no es un PDF válido." : "El archivo no es un documento DOCX válido.";
  }
  return null;
}

/**
 * Postulación pública, sin sesión. Orden: configuración, campo trampa,
 * verificación del desafío, uso único del desafío, comprobaciones baratas (datos,
 * firma del CV, vacante abierta, aviso vigente) SIN gastar cupo, límite por IP
 * (HMAC), validación completa del CV, extracción, subida, registro atómico y
 * evaluación diferida. Un posible duplicado recibe la misma respuesta que
 * cualquier otra postulación.
 */
export async function submitOnlineApplication(formData: FormData): Promise<SubmitApplicationResult> {
  try {
    return await processSubmission(formData);
  } catch (error) {
    logServerError("online_apply.submit", error);
    return fail(MESSAGES.generic);
  }
}

async function processSubmission(formData: FormData): Promise<SubmitApplicationResult> {
  // 1. Configuración.
  const config = getOnlineApplyConfig();
  if (!config.enabled) return fail(MESSAGES.unavailable);

  // 2. Campo trampa: el mismo éxito, con una referencia ficticia y sin registrar nada.
  if (textValue(formData.get("website")).trim() !== "") return { ok: true, reference: fakeReference() };

  // 3. Desafío: firma, vacante, antigüedad y bits.
  const vacancyCode = textValue(formData.get("vacancyCode"));
  const challenge = textValue(formData.get("challenge"));
  const solution = textValue(formData.get("solution"));
  if (!VACANCY_CODE.test(vacancyCode)) return fail(MESSAGES.challenge, { refreshChallenge: true });
  const check = verifyChallenge(config.secret, vacancyCode, challenge, solution);
  if (!check.ok) return fail(MESSAGES.challenge, { refreshChallenge: true });

  // 4. Uso único del desafío, antes de cualquier trabajo con los datos.
  const admin = createSupabaseAdminClient();
  const { data: fresh, error: challengeError } = await admin.rpc("consume_form_challenge", { p_hash: check.hash });
  if (challengeError) {
    logServerError("online_apply.challenge", challengeError);
    return fail(MESSAGES.generic, { refreshChallenge: true });
  }
  if (fresh !== true) return fail(MESSAGES.challenge, { refreshChallenge: true });

  // 5. Comprobaciones baratas, sin gastar cupo por conexión.
  const parsed = onlineApplicationSchema.safeParse({
    fullName: textValue(formData.get("fullName")),
    email: textValue(formData.get("email")),
    phone: textValue(formData.get("phone")),
    location: textValue(formData.get("location")),
    linkedinUrl: textValue(formData.get("linkedinUrl")),
    acceptNotice: checkboxValue(formData.get("acceptNotice")),
    acceptTalentPool: checkboxValue(formData.get("acceptTalentPool")),
    noticeId: textValue(formData.get("noticeId")),
  });
  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
  }
  const file = formData.get("cv");
  let bytes: Uint8Array | null = null;
  if (!(file instanceof File) || file.size === 0) {
    fieldErrors.cv = ["Adjunte su CV en PDF o Word."];
  } else if (file.size > MAX_RESUME_BYTES) {
    fieldErrors.cv = ["El archivo supera el tamaño máximo de 4 MB."];
  } else {
    bytes = new Uint8Array(await file.arrayBuffer());
    const problem = cheapResumeCheck(file, bytes);
    if (problem) fieldErrors.cv = [problem];
  }
  if (!parsed.success || !(file instanceof File) || !bytes || fieldErrors.cv) {
    return fail(MESSAGES.validation, { fieldErrors, refreshChallenge: true });
  }
  const values = parsed.data;

  // Vacante pública y abierta; aviso vigente (el mismo mensaje que RH412).
  const vacancy = await getPublicVacancy(vacancyCode);
  if (!vacancy || !vacancy.acceptingApplications) return fail(MESSAGES.closed);
  const notice = await getCurrentPrivacyNotice();
  if (!notice || notice.id !== values.noticeId) return fail(MESSAGES.noticeChanged, { reload: true });

  // 6. Límite por IP (HMAC), por vacante y total.
  const subject = rateLimitSubject(config.secret, await headers());
  const { data: allowed, error: limitError } = await admin.rpc("consume_public_rate_limit", {
    p_subject: subject,
    p_vacancy_code: vacancyCode,
  });
  if (limitError) {
    logServerError("online_apply.rate_limit", limitError);
    return fail(MESSAGES.generic, { refreshChallenge: true });
  }
  if (allowed !== true) return fail(MESSAGES.rateLimited, { refreshChallenge: true });

  // 7. Validación completa del CV, extracción, subida y registro.
  const validation = validateResumeFile({ name: file.name, size: file.size, declaredType: file.type, bytes });
  if (!validation.ok) {
    return fail(MESSAGES.validation, { fieldErrors: { cv: [validation.reason] }, refreshChallenge: true });
  }
  const resume = { bytes, kind: validation.kind, mimeType: validation.mimeType, filename: validation.safeName };

  const sha256 = createHash("sha256").update(resume.bytes).digest("hex");
  // Sin OCR en línea: la persona recibe la respuesta enseguida; el OCR corre después.
  const extraction = await extractResume(resume.bytes, resume.kind);
  const scanned = needsOcr(extraction);

  const candidateId = randomUUID();
  const resumeId = randomUUID();
  const storagePath = resumeStoragePath(candidateId, resumeId, resume.kind);
  const { error: uploadError } = await admin.storage.from(RESUMES_BUCKET).upload(storagePath, resume.bytes, {
    contentType: resume.mimeType,
    upsert: false,
    cacheControl: "no-store",
  });
  if (uploadError) {
    logServerError("online_apply.storage_upload", { code: uploadError.name });
    return fail(MESSAGES.generic, { refreshChallenge: true });
  }

  const callSubmit = () =>
    admin.rpc("submit_online_application", {
      p_vacancy_code: vacancyCode,
      p_notice_id: values.noticeId,
      p_portal_name: portalFromReferrer(textValue(formData.get("referrer"))),
      p_accept_talent_pool: values.acceptTalentPool,
      p_candidate_id: candidateId,
      p_resume_id: resumeId,
      p_storage_path: storagePath,
      p_full_name: values.fullName,
      p_email: values.email ?? "",
      p_phone: values.phone ?? null,
      p_city: values.location ?? null,
      p_linkedin_url: values.linkedinUrl ?? null,
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

  // Una excepción (p. ej. de red) cuenta como fallo: misma compensación.
  let data: Awaited<ReturnType<typeof callSubmit>>["data"] = null;
  let error: { code?: string } | null = null;
  try {
    ({ data, error } = await callSubmit());
  } catch (thrown) {
    error = { code: typeof thrown === "object" && thrown && "code" in thrown ? String(thrown.code) : "excepcion" };
  }
  const result = data?.[0];
  if (error || !result?.application_id || !result.public_reference) {
    // Si el registro se confirmó pero la respuesta se perdió, el CV ya está
    // referenciado: no se borra el archivo y se recupera la referencia.
    const committed = await isResumeRegistered(admin, resumeId);
    if (committed === true) {
      const { data: saved } = await admin
        .from("applications")
        .select("id, public_reference")
        .eq("resume_id", resumeId)
        .maybeSingle();
      if (saved?.public_reference) {
        scheduleEvaluation(admin, saved.id, scanned ? { resumeId, bytes: resume.bytes } : undefined);
        return { ok: true, reference: saved.public_reference };
      }
      logServerError("online_apply.recover", { code: "referencia_no_recuperada" });
      return fail(MESSAGES.generic, { refreshChallenge: true });
    }
    // Solo se borra cuando consta que no quedó registrado; si no se pudo
    // comprobar, es preferible un archivo huérfano a un CV sin archivo.
    if (committed === false) await removeUpload(admin, storagePath);

    if (error?.code === "RH412") return fail(MESSAGES.noticeChanged, { reload: true });
    if (error?.code === "RH409" || error?.code === "RH404") return fail(MESSAGES.closed);
    logServerError("online_apply.rpc", error ?? { code: "sin-resultado" });
    return fail(MESSAGES.generic, { refreshChallenge: true });
  }

  // 8. Evaluación por reglas después de responder; si falla, queda sin evaluar.
  scheduleEvaluation(admin, result.application_id, scanned ? { resumeId, bytes: resume.bytes } : undefined);

  // 9. Referencia para la persona.
  return { ok: true, reference: result.public_reference };
}
