import "server-only";
import { randomUUID, createHash } from "node:crypto";
import { after } from "next/server";
import { logServerError, toAppError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evaluateApplication } from "@/modules/evaluation/service";
import { resumeStoragePath } from "@/modules/intake/paths";
import { getPublicVacancy } from "@/modules/public-jobs/queries";
import { extractResume, needsOcr } from "@/modules/resumes/extraction";
import { applyOcrToResume } from "@/modules/resumes/ocr-apply";
import { RESUMES_BUCKET } from "@/modules/resumes/storage";
import type { Json } from "@/types/database";
import { getTalentApplyConfig } from "./config";
import { mapTalentApplyError, TalentApplyError } from "./errors";
import { validateIncomingResume } from "./resume";
import { MAX_BODY_BYTES, talentApplyPayloadSchema } from "./schema";
import { isValidApplyToken } from "./token";

const PROVIDER = "talent_apply";

/** Respuestas sin caché y sin repetir nunca la entrada recibida. */
const RESPONSE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function notFound(): Response {
  return new Response(null, { status: 404, headers: RESPONSE_HEADERS });
}

function jsonResponse(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

function isJsonContentType(value: string | null): boolean {
  return /^application\/(?:[a-z0-9.+-]+\+)?json\s*(?:;|$)/i.test((value ?? "").trim());
}

/**
 * Lee el cuerpo con tope de tamaño: primero por `content-length` y después
 * mientras se lee (el encabezado puede faltar o mentir).
 */
async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) throw new TalentApplyError(400, "json_invalido");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TalentApplyError(413, "cuerpo_demasiado_grande");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

async function removeUpload(admin: AdminClient, path: string): Promise<void> {
  const { error } = await admin.storage.from(RESUMES_BUCKET).remove([path]);
  if (error) logServerError("talent_apply.orphan", { code: "archivo_huerfano" });
}

/** `true` o `false` si consta en la base de datos; `null` si no se pudo comprobar. */
async function isResumeRegistered(admin: AdminClient, resumeId: string): Promise<boolean | null> {
  const { data, error } = await admin.from("resumes").select("id").eq("id", resumeId).maybeSingle();
  if (error) {
    logServerError("talent_apply.verify_registration", { code: error.code });
    return null;
  }
  return data !== null;
}

/** Constancia de una postulación rechazada; un fallo aquí no cambia la respuesta. */
async function recordRejection(admin: AdminClient, externalId: string, vacancyCode: string, reason: string): Promise<void> {
  const { error } = await admin.rpc("reject_integration_submission", {
    p_provider: PROVIDER,
    p_external_id: externalId,
    p_vacancy_code: vacancyCode,
    p_reason: reason,
  });
  if (error) logServerError("talent_apply.reject", error);
}

async function processApplication(request: Request, vacancyCode: string): Promise<Response> {
  const admin = createSupabaseAdminClient();

  // 1. Vacante inexistente o no pública: 404 sin detalle.
  const vacancy = await getPublicVacancy(vacancyCode);
  if (!vacancy) return notFound();

  // 2. Límite de solicitudes (por vacante y por día, sin IP).
  const { data: allowed, error: limitError } = await admin.rpc("consume_integration_rate_limit", {
    p_provider: PROVIDER,
    p_vacancy_code: vacancyCode,
  });
  if (limitError) throw toAppError(limitError);
  if (allowed !== true) throw new TalentApplyError(429, "limite_excedido");

  // 3. Cuerpo y JSON.
  const text = await readLimitedText(request, MAX_BODY_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TalentApplyError(400, "json_invalido");
  }
  const parsed = talentApplyPayloadSchema.safeParse(json);
  if (!parsed.success) {
    // Constancia del rechazo cuando al menos el identificador es utilizable.
    const rawId = typeof json === "object" && json !== null ? (json as { id?: unknown }).id : undefined;
    const externalId = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
    if (externalId.length > 0 && externalId.length <= 200) {
      await recordRejection(admin, externalId, vacancyCode, "carga_invalida");
    }
    throw new TalentApplyError(422, "carga_invalida");
  }
  const payload = parsed.data;

  // 4. Repetición: ya registrada, sin trabajo adicional.
  const { data: previous, error: previousError } = await admin
    .from("integration_submissions")
    .select("status")
    .eq("provider", PROVIDER)
    .eq("external_id", payload.id)
    .maybeSingle();
  if (previousError) throw toAppError(previousError);
  if (previous?.status === "registrada") return jsonResponse(200, { status: "ok" });

  if (!vacancy.acceptingApplications) throw new TalentApplyError(410, "vacante_cerrada");

  // 5. CV: por contenido, con los validadores de la subida habitual.
  const resume = validateIncomingResume(payload.applicant.resume.file);
  if (!resume.ok) {
    await recordRejection(admin, payload.id, vacancyCode, resume.reason);
    throw new TalentApplyError(422, resume.reason);
  }

  // 6. Registro: ids, archivo en su ruta definitiva y función atómica.
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
    logServerError("talent_apply.storage_upload", { code: uploadError.name });
    throw new TalentApplyError(500, "error_interno");
  }

  const { data, error } = await admin.rpc("register_integration_application", {
    p_provider: PROVIDER,
    p_external_id: payload.id,
    p_vacancy_code: vacancyCode,
    p_candidate_id: candidateId,
    p_resume_id: resumeId,
    p_storage_path: storagePath,
    p_full_name: payload.applicant.fullName,
    p_email: payload.applicant.email,
    p_phone: payload.applicant.phoneNumber ?? null,
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
    // referenciado: no se borra el archivo y se responde como registrada.
    const committed = await isResumeRegistered(admin, resumeId);
    if (committed === true) return jsonResponse(200, { status: "ok" });
    // Solo se borra cuando consta que no quedó registrado; si no se pudo
    // comprobar, es preferible un archivo huérfano a un CV sin archivo.
    if (committed === false) await removeUpload(admin, storagePath);
    // Se lanza el error original para distinguir RH409 (vacante cerrada → 410).
    throw error ?? new TalentApplyError(500, "error_interno");
  }
  if (result.already_registered) {
    // Otra solicitud con el mismo id se registró antes: este archivo sobra.
    await removeUpload(admin, storagePath);
    return jsonResponse(200, { status: "ok" });
  }

  // 7. Evaluación por reglas si los criterios están aprobados. Si falla, la
  // postulación queda registrada sin evaluar y la respuesta sigue siendo 200.
  const applicationId = result.application_id;
  const evaluate = async () => {
    try {
      await evaluateApplication(admin, applicationId, "reglas", { system: true });
    } catch (evaluationError) {
      logServerError("talent_apply.evaluate", evaluationError);
    }
  };
  if (needsOcr(extraction)) {
    // PDF escaneado: OCR y evaluación después de responder (el OCR es lento).
    const resumeBytes = resume.bytes;
    after(async () => {
      try {
        await applyOcrToResume(admin, resumeId, resumeBytes);
      } catch (ocrError) {
        logServerError("talent_apply.ocr", ocrError);
      }
      await evaluate();
    });
  } else {
    await evaluate();
  }
  return jsonResponse(200, { status: "ok" });
}

/** POST /api/integraciones/talent/postular/[code]/[token] */
export async function receiveTalentApply(request: Request, vacancyCode: string, token: string): Promise<Response> {
  try {
    const config = getTalentApplyConfig();
    if (!config.enabled || !isValidApplyToken(config.secret, vacancyCode, token)) return notFound();

    if (!isJsonContentType(request.headers.get("content-type"))) {
      throw new TalentApplyError(415, "tipo_no_admitido");
    }
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      throw new TalentApplyError(413, "cuerpo_demasiado_grande");
    }
    return await processApplication(request, vacancyCode);
  } catch (error) {
    const status = mapTalentApplyError(error);
    if (status === 404) return notFound();
    if (status >= 500) logServerError("talent_apply.receive", error);
    const code = error instanceof TalentApplyError ? error.code : status === 500 ? "error_interno" : `error_${status}`;
    return jsonResponse(status, { status: "error", code });
  }
}
