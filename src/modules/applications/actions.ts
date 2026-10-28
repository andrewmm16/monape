"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requireActiveUser, requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { AppError, logServerError, toAppError } from "@/lib/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CRITERIA_NOT_APPROVED_MESSAGE,
  evaluateApplication,
  ResumeTextUnavailableError,
} from "@/modules/evaluation/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyOcrToResume } from "@/modules/resumes/ocr-apply";
import { RESUMES_BUCKET } from "@/modules/resumes/storage";
import { pendingEvaluationsQuery } from "./queries";
import { changeStatusSchema, noteSchema, reviewSchema, type ChangeStatusInput, type ReviewInput } from "./schemas";

function revalidateApplication(applicationId: string) {
  revalidatePath(`/postulaciones/${applicationId}`);
  revalidatePath("/panel");
}

/** Cambio de estado del proceso: decisión humana, independiente de la IA. */
export async function changeApplicationStatus(input: ChangeStatusInput): Promise<ActionResult> {
  return runAction(
    "applications.status",
    async () => {
      await requirePermission("applications:manage");
      const values = parseInput(changeStatusSchema, input);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("change_application_status", {
        p_application_id: values.applicationId,
        p_new_status: values.status,
        p_reason: values.reason || null,
        p_note: values.note || null,
      });
      if (error) throw toAppError(error);
      revalidateApplication(values.applicationId);
      return null;
    },
    "Estado actualizado y registrado en el historial.",
  );
}

/**
 * Pide la opinión de una persona sobre la postulación (o retira la solicitud
 * con `profileId` nulo). La base de datos le envía la notificación.
 */
export async function requestOpinion(applicationId: string, profileId: string | null): Promise<ActionResult> {
  return runAction(
    "applications.opinion",
    async () => {
      await requirePermission("applications:manage");
      const values = parseInput(z.object({ applicationId: z.uuid(), profileId: z.uuid().nullable() }), {
        applicationId,
        profileId,
      });
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("request_opinion", {
        p_application_id: values.applicationId,
        p_profile_id: values.profileId,
      });
      if (error) throw toAppError(error);
      revalidateApplication(values.applicationId);
      return null;
    },
    profileId ? "Solicitud de opinión enviada." : "Solicitud de opinión retirada.",
  );
}

/**
 * Asocia la postulación con la versión vigente del CV del candidato. Las
 * evaluaciones usan el CV asociado a la postulación, por lo que una carga
 * posterior no cambia lo evaluado hasta que RRHH lo decide.
 */
export async function linkCurrentResume(applicationId: string): Promise<ActionResult> {
  return runAction(
    "applications.resume",
    async () => {
      await requirePermission("applications:manage");
      const id = parseInput(z.uuid(), applicationId);
      const supabase = await createSupabaseServerClient();
      const { data: application, error } = await supabase
        .from("applications")
        .select("candidate_id")
        .eq("id", id)
        .maybeSingle();
      if (error) throw toAppError(error);
      if (!application) throw new AppError("La postulación no existe o no tiene acceso.", "not_found");
      const { data: resume, error: resumeError } = await supabase
        .from("resumes")
        .select("id")
        .eq("candidate_id", application.candidate_id)
        .eq("is_current", true)
        .maybeSingle();
      if (resumeError) throw toAppError(resumeError);
      if (!resume) throw new AppError("El candidato no tiene un CV cargado.", "conflict");
      const { error: updateError } = await supabase.from("applications").update({ resume_id: resume.id }).eq("id", id);
      if (updateError) throw toAppError(updateError);
      revalidateApplication(id);
      return null;
    },
    "La postulación usará la versión vigente del CV en las próximas evaluaciones.",
  );
}

/** Observación interna sobre la postulación. */
export async function addApplicationNote(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  return runAction(
    "applications.note",
    async () => {
      const user = await requireActiveUser();
      if (!can(user.role, "applications:add_note")) throw new AppError("No tiene permisos.", "forbidden");
      const values = parseInput(noteSchema, input);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase
        .from("application_events")
        .insert({ application_id: values.applicationId, event_type: "observacion", note: values.note });
      if (error) throw toAppError(error);
      revalidateApplication(values.applicationId);
      return null;
    },
    "Observación registrada.",
  );
}

export async function runEvaluation(applicationId: string, method: string): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "evaluations.run",
    async () => {
      await requirePermission("evaluations:run");
      const values = parseInput(z.object({ applicationId: z.uuid(), method: z.enum(["reglas", "ia"]) }), {
        applicationId,
        method,
      });
      const supabase = await createSupabaseServerClient();
      await enforceRateLimit(supabase, values.method === "ia" ? RATE_LIMITS.aiEvaluation : RATE_LIMITS.evaluation);
      const id = await evaluateApplication(supabase, values.applicationId, values.method);
      revalidateApplication(values.applicationId);
      return { id };
    },
    "Evaluación generada. Revísela antes de tomar decisiones.",
  );
}

/** Postulaciones que evalúa cada llamada de «Evaluar pendientes». */
const PENDING_CHUNK_SIZE = 25;
/** Tiempo máximo por llamada; se revisa antes de cada postulación. */
const PENDING_TIME_BUDGET_MS = 8_000;
const MAX_WITHOUT_TEXT_LISTED = 50;
/** Solo se lanza un OCR si desde el inicio de la llamada pasó como máximo este tiempo. */
const OCR_START_WINDOW_MS = 2_000;
/** Espera máxima en la cola del OCR dentro del lote (los demás caminos esperan 60 s). */
const OCR_BATCH_QUEUE_MS = 5_000;

export type EvaluatePendingSummary = {
  evaluated: number;
  /** Evaluadas después de leer su CV escaneado con OCR (ya incluidas en `evaluated`). */
  ocrRead: number;
  withoutText: { applicationId: string; candidateName: string }[];
  failed: number;
  nextCursor: string | null;
  remaining: number;
};

type ScannedResume = { id: string; storage_path: string };

/**
 * CV que se evalúa de la postulación, si es un PDF sin texto cuyo OCR aún no se
 * intentó y sin texto corregido por RRHH. Misma elección del CV que el servicio
 * de evaluación (el asociado a la postulación o, si no hay, el vigente).
 */
async function findUnreadScan(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  applicationId: string,
): Promise<ScannedResume | null> {
  const { data: application, error } = await supabase
    .from("applications")
    .select("candidate_id, resume_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!application) return null;
  let query = supabase
    .from("resumes")
    .select("id, storage_path, mime_type, resume_extractions(status, method, corrected_text)")
    .eq("candidate_id", application.candidate_id);
  query = application.resume_id ? query.eq("id", application.resume_id) : query.eq("is_current", true);
  const { data: resume, error: resumeError } = await query.maybeSingle();
  if (resumeError) throw toAppError(resumeError);
  const extraction = resume?.resume_extractions;
  if (!resume || !extraction || resume.mime_type !== "application/pdf") return null;
  if (extraction.status !== "sin_texto" || extraction.method !== "pdf_text" || extraction.corrected_text) return null;
  return { id: resume.id, storage_path: resume.storage_path };
}

/**
 * Resultado de intentar el OCR de una postulación del lote:
 * - `no_intentado`: el OCR no llegó a lanzarse (cola ocupada o sin motor);
 * - `fallido`: se intentó, pero no quedó texto utilizable (o no se pudo abrir el archivo);
 * - `leido`: se aplicó y quedó texto utilizable;
 * - `cambiado`: no se aplicó porque el CV cambió mientras tanto (p. ej. RRHH transcribió).
 */
type BatchOcrResult = "no_intentado" | "fallido" | "leido" | "cambiado";

async function readScan(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scan: ScannedResume,
): Promise<BatchOcrResult> {
  const { data: file, error } = await createSupabaseAdminClient().storage.from(RESUMES_BUCKET).download(scan.storage_path);
  if (error || !file) {
    logServerError("evaluations.run_pending", { code: error?.name ?? "sin-archivo" });
    return "fallido";
  }
  const result = await applyOcrToResume(supabase, scan.id, new Uint8Array(await file.arrayBuffer()), {
    queueTimeoutMs: OCR_BATCH_QUEUE_MS,
  });
  if (!result.attempted) return "no_intentado";
  if (!result.applied) return "cambiado";
  return result.status === "completada" ? "leido" : "fallido";
}

/** Consume el límite `cv_ocr`; false si se alcanzó (o no se pudo verificar): no se lanza el OCR. */
async function consumeOcrLimit(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<boolean> {
  try {
    await enforceRateLimit(supabase, RATE_LIMITS.cvOcr);
    return true;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return false;
  }
}

/**
 * Evalúa con el motor de reglas un tramo de las postulaciones pendientes de la
 * vacante. El cliente repite la llamada con `nextCursor` hasta que `remaining`
 * sea 0; el cursor evita reintentar en bucle las que fallan.
 */
export async function evaluatePendingApplications(input: {
  vacancyId: string;
  cursor: string | null;
}): Promise<ActionResult<EvaluatePendingSummary>> {
  return runAction("evaluations.run_pending", async () => {
    await requirePermission("evaluations:run");
    const values = parseInput(z.object({ vacancyId: z.uuid(), cursor: z.uuid().nullable() }), input);
    const supabase = await createSupabaseServerClient();
    await enforceRateLimit(supabase, RATE_LIMITS.evaluationBulk);
    const startedAt = Date.now();

    const { data: vacancy, error: vacancyError } = await supabase
      .from("vacancies")
      .select("id, criteria_approved_at")
      .eq("id", values.vacancyId)
      .maybeSingle();
    if (vacancyError) throw toAppError(vacancyError);
    if (!vacancy) throw new AppError("La vacante no existe o no tiene acceso.", "not_found");
    if (!vacancy.criteria_approved_at) throw new AppError(CRITERIA_NOT_APPROVED_MESSAGE, "conflict");

    let pendingQuery = pendingEvaluationsQuery(supabase, vacancy.id);
    if (values.cursor) pendingQuery = pendingQuery.gt("id", values.cursor);
    const { data: pending, error: pendingError } = await pendingQuery.order("id").limit(PENDING_CHUNK_SIZE);
    if (pendingError) throw toAppError(pendingError);

    let evaluated = 0;
    let ocrRead = 0;
    let ocrUsed = false;
    let failed = 0;
    let nextCursor = values.cursor;
    const withoutText: EvaluatePendingSummary["withoutText"] = [];
    for (const application of pending ?? []) {
      if (!application.id) continue;
      if (Date.now() - startedAt > PENDING_TIME_BUDGET_MS) break;
      const previousCursor = nextCursor;
      nextCursor = application.id;
      try {
        try {
          await evaluateApplication(supabase, application.id, "reglas");
          evaluated += 1;
        } catch (error) {
          if (!(error instanceof ResumeTextUnavailableError)) throw error;
          // PDF escaneado: máximo un OCR por llamada y solo al principio de ella (es lento).
          const scan = await findUnreadScan(supabase, application.id).catch(() => null);
          if (!scan) throw error;
          const progressed = evaluated + failed + withoutText.length > 0;
          if (ocrUsed || Date.now() - startedAt > OCR_START_WINDOW_MS) {
            // Queda para la siguiente llamada. Si esta es la primera postulación de la llamada
            // se cuenta como sin texto: así el cursor siempre avanza y no hay bucles.
            if (!progressed) throw error;
            nextCursor = previousCursor;
            break;
          }
          if (!(await consumeOcrLimit(supabase))) throw error;
          const ocr = await readScan(supabase, scan);
          if (ocr === "no_intentado") {
            if (!progressed) throw error;
            nextCursor = previousCursor;
            break;
          }
          ocrUsed = true;
          if (ocr === "fallido") throw error;
          // «leido» y «cambiado» (RRHH transcribió mientras tanto) ya tienen texto: se evalúa una vez.
          await evaluateApplication(supabase, application.id, "reglas");
          evaluated += 1;
          if (ocr === "leido") ocrRead += 1;
        }
      } catch (error) {
        if (error instanceof ResumeTextUnavailableError) {
          withoutText.push({ applicationId: application.id, candidateName: application.candidate_name ?? "Candidato" });
        } else {
          failed += 1;
          logServerError("evaluations.run_pending", error);
        }
      }
    }

    let remainingQuery = pendingEvaluationsQuery(supabase, vacancy.id, { head: true });
    if (nextCursor) remainingQuery = remainingQuery.gt("id", nextCursor);
    const { count, error: remainingError } = await remainingQuery;
    if (remainingError) throw toAppError(remainingError);

    revalidatePath(`/vacantes/${vacancy.id}`);
    revalidatePath("/postulaciones");
    return {
      evaluated,
      ocrRead,
      withoutText: withoutText.slice(0, MAX_WITHOUT_TEXT_LISTED),
      failed,
      nextCursor,
      remaining: count ?? 0,
    };
  });
}

export async function reviewEvaluation(applicationId: string, input: ReviewInput): Promise<ActionResult> {
  return runAction(
    "evaluations.review",
    async () => {
      await requirePermission("evaluations:review");
      const application = parseInput(z.uuid(), applicationId);
      const values = parseInput(reviewSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data: evaluation, error: lookupError } = await supabase
        .from("candidate_evaluations")
        .select("application_id")
        .eq("id", values.evaluationId)
        .maybeSingle();
      if (lookupError) throw toAppError(lookupError);
      if (!evaluation || evaluation.application_id !== application) {
        throw new AppError("La evaluación no corresponde a la postulación.", "not_found");
      }
      const { error } = await supabase.rpc("review_evaluation", {
        p_evaluation_id: values.evaluationId,
        p_outcome: values.outcome,
        p_notes: values.notes,
      });
      if (error) throw toAppError(error);
      revalidateApplication(application);
      return null;
    },
    "Revisión registrada.",
  );
}
