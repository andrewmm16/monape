import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyOcrToResume } from "@/modules/resumes/ocr-apply";
import { RESUMES_BUCKET } from "@/modules/resumes/storage";
import { evaluateApplication, ResumeTextUnavailableError } from "./service";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Acepta el cuerpo propio `{ "applicationId": "<uuid>" }` o el de un Database
 * Webhook de Supabase (INSERT en `applications`): `{ "record": { "id": "<uuid>" } }`.
 */
const payloadSchema = z.union([
  z.object({ applicationId: z.uuid(), force: z.boolean().optional() }).transform((p) => p),
  z
    .object({ type: z.literal("INSERT"), table: z.literal("applications"), record: z.object({ id: z.uuid() }) })
    .transform((p) => ({ applicationId: p.record.id, force: false })),
]);

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Comparación en tiempo constante que tampoco revela la longitud. */
function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return token !== "" && safeEqual(token, secret);
}

/**
 * Lee con OCR el CV de la postulación si quedó sin texto (PDF escaneado).
 * Un fallo aquí no impide intentar la evaluación: esta informará la falta de texto.
 */
async function ensureResumeText(admin: ReturnType<typeof createSupabaseAdminClient>, applicationId: string) {
  const { data: application } = await admin
    .from("applications")
    .select("candidate_id, resume_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) return;

  let query = admin
    .from("resumes")
    .select("id, storage_path, resume_extractions(status, method)")
    .eq("candidate_id", application.candidate_id);
  query = application.resume_id ? query.eq("id", application.resume_id) : query.eq("is_current", true);
  const { data: resume } = await query.maybeSingle();
  const extraction = resume?.resume_extractions;
  if (!resume || !extraction || !(extraction.method === "pdf_text" && extraction.status === "sin_texto")) return;

  const { data: file, error } = await admin.storage.from(RESUMES_BUCKET).download(resume.storage_path);
  if (error || !file) {
    logServerError("evaluar_cv.download", error);
    return;
  }
  try {
    await applyOcrToResume(admin, resume.id, new Uint8Array(await file.arrayBuffer()));
  } catch (ocrError) {
    logServerError("evaluar_cv.ocr", ocrError);
  }
}

/**
 * POST /api/evaluar-cv. Webhook interno: evalúa con el motor de reglas (sin
 * enviar datos a terceros) una postulación recién insertada y guarda la
 * evaluación, con su puntaje y las citas del CV como evidencia, en las tablas
 * `candidate_evaluations` y `candidate_evaluation_items`.
 *
 * Apagado (404) mientras EVALUATION_WEBHOOK_SECRET no esté definido. Es idempotente:
 * si la postulación ya tiene una evaluación no la repite, salvo `force: true`.
 */
export async function handleEvaluateWebhook(request: Request): Promise<Response> {
  const secret = getServerEnv().EVALUATION_WEBHOOK_SECRET;
  if (!secret || !isAuthorized(request, secret)) return json(404, { error: "no_encontrado" });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { error: "cuerpo_demasiado_grande" });

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return json(400, { error: "json_invalido" });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return json(422, { error: "payload_invalido" });
  const { applicationId, force } = parsed.data;

  try {
    const admin = createSupabaseAdminClient();
    const { data: current, error } = await admin
      .from("applications")
      .select("latest_evaluation_id")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    if (!current) return json(404, { error: "postulacion_no_encontrada" });
    if (current.latest_evaluation_id && !force) {
      return json(200, { status: "ya_evaluada", evaluationId: current.latest_evaluation_id });
    }

    await ensureResumeText(admin, applicationId);
    const evaluationId = await evaluateApplication(admin, applicationId, "reglas", { system: true });

    const { data: evaluation } = await admin
      .from("candidate_evaluations")
      .select("score, level")
      .eq("id", evaluationId)
      .maybeSingle();
    return json(200, { status: "evaluada", evaluationId, score: evaluation?.score ?? null, level: evaluation?.level ?? null });
  } catch (error) {
    logServerError("evaluar_cv", error);
    // Sin texto legible o criterios sin aprobar: el remitente puede corregir y reintentar.
    if (error instanceof ResumeTextUnavailableError) return json(409, { error: "cv_sin_texto" });
    if (typeof error === "object" && error && "code" in error && error.code === "conflict") {
      return json(409, { error: "criterios_no_aprobados" });
    }
    return json(500, { error: "error_interno" });
  }
}
