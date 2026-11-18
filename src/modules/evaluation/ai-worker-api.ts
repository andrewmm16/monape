import "server-only";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { AppError, logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import { safeEqual } from "@/modules/integrations/talent-apply/token";
import { sendEmail } from "@/modules/notifications/email/client";
import { escapeHtml } from "@/modules/notifications/email/templates/html";
import { httpStatusOf, json } from "@/modules/portal-bot/auth";
import { assembleEvaluation } from "./assemble";
import { getAiAvailability } from "./ai/availability";
import { engineNotesForText } from "./ai/engine-notes";
import { AI_OUTPUT_JSON_SCHEMA, buildAiInput } from "./ai/input";
import { PROMPT_VERSION } from "./ai/prompt";
import { interpretAiResponse, InvalidAiResponseError } from "./ai/response";
import {
  APPLICATION_NOT_FOUND_MESSAGE,
  CRITERIA_NOT_APPROVED_MESSAGE,
  loadEvaluationContext,
  NO_REQUIREMENTS_MESSAGE,
  ResumeTextUnavailableError,
  type EvaluationContext,
} from "./context";
import { detectDateSignalNotes } from "./date-consistency";
import { listVerifications } from "./service";
import { applyVerifications } from "./verifications";

/**
 * API del worker de IA (ia-worker/), que ejecuta el CLI de Claude con la
 * suscripción. El worker solo transporta: aquí se arma el prompt, se valida la
 * respuesta contra el CV y se registra la evaluación. Barrera:
 * `Authorization: Bearer <AI_WORKER_SECRET>`; sin secreto la API no existe (404).
 */

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Esfuerzo de razonamiento pedido al modelo (igual que en la evaluación directa). */
const AI_EFFORT = "medium";
/** Trabajos que se intentan preparar por reclamo antes de responder «sin trabajo». */
const MAX_PREPARE_ATTEMPTS = 5;
/** Tamaño máximo del cuerpo del resultado (la salida estructurada pesa unos pocos KB). */
const MAX_BODY_BYTES = 512 * 1024;

// `claimToken` identifica la reserva: un worker cuya reserva venció no puede tocar la de otro.
const reportBody = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("ok"),
    claimToken: z.uuid(),
    output: z.unknown(),
    model: z
      .string()
      .regex(/^[A-Za-z0-9._:\-[\]]{1,100}$/)
      .optional(),
  }),
  z.object({
    outcome: z.literal("limite"),
    claimToken: z.uuid(),
    errorCode: z.enum(["limite_plan", "sin_sesion", "worker_no_disponible"]).default("limite_plan"),
    retryAt: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({
    outcome: z.literal("error"),
    claimToken: z.uuid(),
    errorCode: z.string().regex(/^[a-z0-9_]{1,64}$/),
    retryable: z.boolean().default(true),
  }),
]);

const PAUSE_REASONS = ["limite_plan", "sin_sesion", "worker_no_disponible"] as const;

const statusBody = z.union([
  z.object({ state: z.literal("activo"), cliVersion: z.string().trim().max(100).optional() }),
  z.object({
    state: z.literal("pausado"),
    reason: z.enum(PAUSE_REASONS),
    until: z.iso.datetime({ offset: true }).optional(),
    cliVersion: z.string().trim().max(100).optional(),
  }),
]);

/** Pausas que no se resuelven solas: alguien tiene que intervenir en la máquina del worker. */
const PAUSES_NEEDING_ACTION: Record<string, { subject: string; action: string }> = {
  sin_sesion: {
    subject: "Evaluación con IA en pausa: hay que renovar la sesión de Claude",
    action:
      "Claude rechazó la sesión del worker (token caducado o revocado). Genere un token nuevo con «claude setup-token» y actualice CLAUDE_CODE_OAUTH_TOKEN en el archivo .env.ia-worker de la máquina del worker; luego reinicie el servicio.",
  },
  worker_no_disponible: {
    subject: "Evaluación con IA en pausa: el worker no encuentra Claude Code",
    action:
      "El worker no puede ejecutar el programa «claude» en su máquina. Reinstale Claude Code o revise IA_WORKER_CLI_PATH y reinicie el servicio.",
  },
};

/** Registra el latido del worker. Devuelve true si cambió su estado. Nunca hace fallar la solicitud. */
async function recordHeartbeat(
  admin: AdminClient,
  status: { state: "activo" | "pausado"; reason?: string; until?: string; cliVersion?: string },
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("ai_worker_heartbeat", {
      p_state: status.state,
      p_reason: status.reason ?? undefined,
      p_until: status.until ?? undefined,
      p_cli_version: status.cliVersion ?? undefined,
    });
    if (error) throw error;
    return data === true;
  } catch (error) {
    logServerError("ai_worker.heartbeat", error);
    return false;
  }
}

/** Avisa por correo a la administración (activa) de una pausa que requiere intervenir. */
async function alertAdmins(admin: AdminClient, reason: string): Promise<void> {
  const alert = PAUSES_NEEDING_ACTION[reason];
  if (!alert) return;
  const { data, error } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "admin")
    .eq("is_active", true)
    .is("deleted_at", null);
  if (error) throw error;
  const text = `${alert.action}\n\nMientras tanto, el motor de reglas sigue evaluando y las evaluaciones con IA quedan en cola sin perderse.`;
  await Promise.all(
    (data ?? [])
      .filter((row): row is { email: string } => Boolean(row.email))
      .map((row) =>
        sendEmail({
          to: row.email,
          subject: alert.subject,
          text,
          html: `<p>${escapeHtml(alert.action)}</p><p>Mientras tanto, el motor de reglas sigue evaluando y las evaluaciones con IA quedan en cola sin perderse.</p>`,
          tags: [{ name: "tipo", value: "ia_worker_pausa" }],
        }),
      ),
  );
}

/**
 * POST /api/ia/estado: latido del worker con su estado. Al entrar en una pausa
 * que requiere intervenir (sesión inválida, CLI ausente) avisa a administración
 * una sola vez por transición.
 */
export async function reportAiWorkerStatus(request: Request): Promise<Response> {
  const denied = rejectUnlessAiWorker(request);
  if (denied) return denied;
  const body = statusBody.safeParse(await readJson(request));
  if (!body.success) return json(422, { error: "payload_invalido" });

  try {
    const admin = createSupabaseAdminClient();
    const status = body.data;
    const changed = await recordHeartbeat(admin, status);
    if (changed && status.state === "pausado") {
      await alertAdmins(admin, status.reason).catch((error: unknown) => logServerError("ai_worker.alert", error));
    }
    return json(200, { status: "ok" });
  } catch (error) {
    logServerError("ai_worker.status", error);
    return json(500, { error: "error_interno" });
  }
}

export function rejectUnlessAiWorker(request: Request): Response | null {
  const secret = getServerEnv().AI_WORKER_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!secret || token === "" || !safeEqual(token, secret)) return json(404, { error: "no_encontrado" });
  return null;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Código de cierre de un fallo de preparación que no se arregla reintentando, o null si es transitorio. */
function permanentCode(error: unknown): string | null {
  if (error instanceof ResumeTextUnavailableError) return "sin_texto";
  if (error instanceof AppError) {
    if (error.message === CRITERIA_NOT_APPROVED_MESSAGE) return "criterios_no_aprobados";
    if (error.message === APPLICATION_NOT_FOUND_MESSAGE) return "postulacion_no_encontrada";
    if (error.message === NO_REQUIREMENTS_MESSAGE) return "sin_requisitos";
  }
  return null;
}

async function release(
  admin: AdminClient,
  jobId: string,
  claimToken: string,
  outcome: "reintentar" | "limite" | "reprogramar" | "error",
  errorCode: string | null = null,
  retryAt: string | null = null,
): Promise<string> {
  const { data, error } = await admin.rpc("ai_release_job", {
    p_job_id: jobId,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_error_code: errorCode ?? undefined,
    p_retry_at: retryAt ?? undefined,
  });
  if (error) throw error;
  return data ?? "pendiente";
}

function aiSettings() {
  const env = getServerEnv();
  return { env, availability: getAiAvailability(env) };
}

/**
 * Prompt del trabajo: CV + requisitos + las dudas del motor de reglas sobre ese
 * mismo texto (el motor decide; la IA resuelve lo que el motor no pudo). Las notas
 * no entran en la huella, así que recalcularlas al recibir el resultado no la cambia.
 */
function inputFor(context: EvaluationContext, maxChars: number) {
  return buildAiInput({
    vacancyTitle: context.vacancyTitle,
    requirements: context.requirements,
    fullText: context.fullText,
    maxChars,
    engineNotes: engineNotesForText(context.fullText, context.requirements),
  });
}

/**
 * POST /api/ia/trabajos/siguiente: reserva el próximo trabajo y entrega el
 * prompt ya armado (CV sin datos de contacto + requisitos) y el esquema de salida.
 */
export async function claimAiJob(request: Request): Promise<Response> {
  const denied = rejectUnlessAiWorker(request);
  if (denied) return denied;

  const { env, availability } = aiSettings();
  // Sin aprobación de la empresa (o con otro proveedor) no se entrega nada.
  if (!availability.available || !availability.queued) return json(200, { job: null, paused: true });

  try {
    const admin = createSupabaseAdminClient();
    // Cada reclamo es también un latido: el worker está vivo y trabajando.
    await recordHeartbeat(admin, { state: "activo" });
    for (let i = 0; i < MAX_PREPARE_ATTEMPTS; i++) {
      const { data, error } = await admin.rpc("ai_claim_job");
      if (error) throw error;
      const job = data?.[0];
      if (!job?.job_id || !job.application_id || !job.claim_token) return json(200, { job: null });

      try {
        const context = await loadEvaluationContext(admin, job.application_id);
        const input = inputFor(context, env.AI_MAX_INPUT_CHARS);
        const { error: startError } = await admin.rpc("ai_start_job", {
          p_job_id: job.job_id,
          p_claim_token: job.claim_token,
          p_input_sha256: input.inputSha256,
          p_criteria_version: context.criteriaVersion,
        });
        if (startError) throw startError;
        return json(200, {
          job: {
            id: job.job_id,
            claimToken: job.claim_token,
            attempt: job.attempts,
            model: availability.model,
            effort: AI_EFFORT,
            system: input.system,
            prompt: input.userMessage,
            schema: AI_OUTPUT_JSON_SCHEMA,
          },
        });
      } catch (prepareError) {
        const code = permanentCode(prepareError);
        if (code) {
          await release(admin, job.job_id, job.claim_token, "error", code);
        } else {
          logServerError("ai_worker.prepare", prepareError);
          await release(admin, job.job_id, job.claim_token, "reintentar", "error_preparacion");
        }
      }
    }
    return json(200, { job: null });
  } catch (error) {
    logServerError("ai_worker.claim", error);
    return json(httpStatusOf(error), { error: "error_interno" });
  }
}

/**
 * POST /api/ia/trabajos/[id]/resultado: salida del modelo (`ok`), espera por
 * límite o sesión (`limite`) o fallo (`error`). Con `ok`, la salida se valida
 * contra el texto enviado y se registra la evaluación con IA.
 */
export async function reportAiJob(request: Request, jobId: string): Promise<Response> {
  const denied = rejectUnlessAiWorker(request);
  if (denied) return denied;
  const body = reportBody.safeParse(await readJson(request));
  if (!body.success || !z.uuid().safeParse(jobId).success) return json(422, { error: "payload_invalido" });

  try {
    const admin = createSupabaseAdminClient();
    const report = body.data;
    const token = report.claimToken;

    if (report.outcome === "limite") {
      return json(200, { status: await release(admin, jobId, token, "limite", report.errorCode, report.retryAt ?? null) });
    }
    if (report.outcome === "error") {
      return json(200, { status: await release(admin, jobId, token, report.retryable ? "reintentar" : "error", report.errorCode) });
    }

    const { data: job, error: jobError } = await admin
      .from("ai_evaluation_jobs")
      .select("id, application_id, status, claim_token, input_sha256, criteria_version")
      .eq("id", jobId)
      .maybeSingle();
    if (jobError) throw jobError;
    // Reserva vencida (otro worker la tomó) o trabajo ya cerrado: no se registra nada.
    if (!job || job.status !== "procesando" || job.claim_token !== token) {
      return json(404, { error: "trabajo_no_reservado" });
    }

    const { env, availability } = aiSettings();
    let context: EvaluationContext;
    try {
      context = await loadEvaluationContext(admin, job.application_id);
    } catch (contextError) {
      const code = permanentCode(contextError);
      if (!code) throw contextError;
      return json(200, { status: await release(admin, jobId, token, "error", code) });
    }

    // El CV o los criterios cambiaron desde la reserva: se vuelve a preparar.
    const input = inputFor(context, env.AI_MAX_INPUT_CHARS);
    if (input.inputSha256 !== job.input_sha256 || context.criteriaVersion !== job.criteria_version) {
      return json(200, { status: await release(admin, jobId, token, "reprogramar") });
    }

    let items;
    try {
      items = interpretAiResponse(report.output, context.requirements, input.evaluatedText);
    } catch (interpretError) {
      if (!(interpretError instanceof InvalidAiResponseError)) throw interpretError;
      return json(200, { status: await release(admin, jobId, token, "reintentar", "respuesta_invalida") });
    }

    // Lo que RRHH comprobó después del CV prevalece, sin perder la valoración original.
    items = applyVerifications(items, await listVerifications(admin, job.application_id));
    const result = assembleEvaluation({
      method: "ia",
      methodVersion: PROMPT_VERSION,
      model: report.model ?? (availability.available ? availability.model : null),
      requirements: context.requirements,
      items,
      textWasCorrected: context.textWasCorrected,
      textTruncated: input.textTruncated,
      signalNotes: detectDateSignalNotes(context.fullText, new Date()),
    });

    const { data: evaluationId, error: completeError } = await admin.rpc("ai_complete_job", {
      p_job_id: jobId,
      p_claim_token: token,
      p_resume_id: context.resumeId,
      p_criteria_version: context.criteriaVersion,
      p_method_version: result.methodVersion,
      p_scoring_version: result.scoringVersion,
      p_model: result.model,
      p_score: result.scores.score,
      p_score_potential: result.scores.potential,
      p_evidence_coverage: result.scores.coverage,
      p_level: result.level,
      p_summary: result.summary,
      p_limitations: result.limitations,
      p_input_sha256: input.inputSha256,
      p_items: result.items.map((item) => ({
        requirement_id: item.requirementId,
        assessment: item.assessment,
        evidence: item.evidence,
        rationale: item.rationale,
        ...(item.cvAssessment ? { cv_assessment: item.cvAssessment } : {}),
        ...(item.cvRationale ? { cv_rationale: item.cvRationale } : {}),
      })) as Json,
    });
    if (completeError) {
      const status = httpStatusOf(completeError);
      // Criterios o huella cambiaron entre la lectura y el registro: se rearma sin contar intento.
      if (status === 409) return json(200, { status: await release(admin, jobId, token, "reprogramar") });
      // La BD rechazó la evaluación (p. ej. una verificación de RRHH registrada mientras tanto):
      // se reintenta con los datos nuevos; cuenta intento para no repetir sin fin.
      if (status === 422) {
        logServerError("ai_worker.complete", completeError);
        return json(200, { status: await release(admin, jobId, token, "reintentar", "registro_rechazado") });
      }
      throw completeError;
    }
    return json(200, { status: "completado", evaluationId });
  } catch (error) {
    logServerError("ai_worker.report", error);
    const status = httpStatusOf(error);
    return json(status, { error: status === 500 ? "error_interno" : "solicitud_rechazada" });
  }
}
