import "server-only";
import { createHash } from "node:crypto";
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
import { buildJudgePrompt, JUDGE_JSON_SCHEMA, JUDGE_SYSTEM_PROMPT, parseJudgeOutput } from "./ai/judge";
import { PROMPT_VERSION } from "./ai/prompt";
import { assessQuality, qualityReportSchema } from "./ai/quality";
import { hasRelayedItems, relayToAi } from "./ai/relay";
import { extractEquivalenceVotes, interpretAiResponse, InvalidAiResponseError } from "./ai/response";
import {
  APPLICATION_NOT_FOUND_MESSAGE,
  CRITERIA_NOT_APPROVED_MESSAGE,
  loadEvaluationContext,
  NO_REQUIREMENTS_MESSAGE,
  ResumeTextUnavailableError,
  type EvaluationContext,
} from "./context";
import { detectEvaluationSignalNotes } from "./signal-notes";
import { loadActiveLearnedRules, recordEquivalenceVotes } from "./learning";
import { evaluateWithRules, RULE_ENGINE_VERSION } from "./rule-engine";
import { listVerifications, recordAssembledEvaluation } from "./service";
import type { ItemAssessment } from "./types";
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

/** Correo a la administración activa (párrafos de texto plano). */
async function emailAdmins(admin: AdminClient, message: { subject: string; paragraphs: string[]; tag: string }): Promise<void> {
  const { data, error } = await admin
    .from("profiles")
    .select("email")
    .eq("role", "admin")
    .eq("is_active", true)
    .is("deleted_at", null);
  if (error) throw error;
  const text = message.paragraphs.join("\n\n");
  const html = message.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  await Promise.all(
    (data ?? [])
      .filter((row): row is { email: string } => Boolean(row.email))
      .map((row) => sendEmail({ to: row.email, subject: message.subject, text, html, tags: [{ name: "tipo", value: message.tag }] })),
  );
}

/** Avisa por correo a la administración (activa) de una pausa que requiere intervenir. */
async function alertAdmins(admin: AdminClient, reason: string): Promise<void> {
  const alert = PAUSES_NEEDING_ACTION[reason];
  if (!alert) return;
  await emailAdmins(admin, {
    subject: alert.subject,
    paragraphs: [alert.action, "Mientras tanto, el motor de reglas sigue evaluando y las evaluaciones con IA quedan en cola sin perderse."],
    tag: "ia_worker_pausa",
  });
}

/**
 * POST /api/ia/vigilancia: resumen de la medición semanal del modelo contra la
 * vara (`npm run vigilar:ia` en la máquina del worker). Se guarda y, si el
 * acierto bajó (ver ai/quality.ts), se avisa por correo a administración.
 */
export async function reportAiQualityCheck(request: Request): Promise<Response> {
  const denied = rejectUnlessAiWorker(request);
  if (denied) return denied;
  const body = qualityReportSchema.safeParse(await readJson(request));
  if (!body.success) return json(422, { error: "payload_invalido" });

  try {
    const admin = createSupabaseAdminClient();
    const report = body.data;
    const { status, reasons } = assessQuality(report);
    const { error } = await admin.from("ai_quality_checks").insert({
      model: report.modelo,
      prompt_version: report.prompt,
      cv_count: report.cv,
      failures: report.fallos,
      order_inversions: report.inversionesIa,
      cells: report.vara?.casillas ?? 0,
      accuracy_engine: report.vara?.motor ?? null,
      accuracy_ai: report.vara?.ia ?? null,
      accuracy_relay: report.vara?.motorIa ?? null,
      accuracy_relay_lenient: report.vara?.motorIaLaxo ?? null,
      ai_over_accredited: report.vara?.iaAcreditoDeMas ?? 0,
      seconds_per_cv: report.segundosPorCv ?? null,
      status,
      reasons,
    });
    if (error) throw error;
    if (status === "alerta") {
      await emailAdmins(admin, {
        subject: "Vigilancia de la IA: bajó la calidad de la segunda opinión",
        paragraphs: [
          `La revisión semanal del modelo ${report.modelo} (prompt ${report.prompt}) contra los CV de prueba encontró:`,
          ...reasons.map((reason) => `• ${reason}`),
          "Puede deberse a un cambio del modelo por parte de Anthropic o a un problema del worker. El motor de reglas sigue siendo la evaluación principal; revise «Configuración → Aprendizaje del motor» y, si hace falta, mida a mano con «npm run medir:ia».",
        ],
        tag: "ia_vigilancia",
      }).catch((mailError: unknown) => logServerError("ai_worker.quality_alert", mailError));
    }
    return json(200, { status });
  } catch (error) {
    logServerError("ai_worker.quality", error);
    return json(500, { error: "error_interno" });
  }
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
 * mismo texto, con lo que ya aprendió (el motor decide; la IA resuelve lo que el
 * motor no pudo). Las notas no entran en la huella, así que recalcularlas al
 * recibir el resultado no la cambia.
 */
async function inputFor(admin: AdminClient, context: EvaluationContext, maxChars: number) {
  const learned = await loadActiveLearnedRules(admin, context.requirements);
  return buildAiInput({
    vacancyTitle: context.vacancyTitle,
    requirements: context.requirements,
    fullText: context.fullText,
    maxChars,
    engineNotes: engineNotesForText(context.fullText, context.requirements, new Date(), learned, context.vacancyText),
  });
}

/**
 * Cuando no hay CV en cola: una regla aprendida que espera al segundo juez, con
 * el mismo formato de un trabajo (el worker solo transporta). Null si no hay.
 */
async function claimJudgment(admin: AdminClient, judgeModel: string) {
  const { data, error } = await admin.rpc("learn_claim_judgment");
  if (error) throw error;
  const task = data?.[0];
  if (!task?.equivalence_id || !task.judge_token || !task.requirement_category || !task.requirement_description || !task.cv_term_display) {
    return null;
  }
  return {
    id: task.equivalence_id,
    claimToken: task.judge_token,
    attempt: Math.max(1, task.attempts ?? 1),
    model: judgeModel,
    effort: AI_EFFORT,
    system: JUDGE_SYSTEM_PROMPT,
    prompt: buildJudgePrompt({
      category: task.requirement_category,
      description: task.requirement_description,
      term: task.cv_term_display,
    }),
    schema: JUDGE_JSON_SCHEMA,
  };
}

/**
 * Resultado de una tarea de juicio, o null si `jobId` no es una (es un CV).
 * Con «ok» la regla se activa (el juez coincide) o se rechaza; con límite o
 * error la reserva se libera y se reintenta más tarde.
 */
async function reportJudgment(
  admin: AdminClient,
  jobId: string,
  report: z.infer<typeof reportBody>,
): Promise<Response | null> {
  const { data: rule, error } = await admin
    .from("learned_equivalences")
    .select("id")
    .eq("id", jobId)
    .eq("judge_token", report.claimToken)
    .maybeSingle();
  if (error) throw error;
  if (!rule) return null;
  const judged = report.outcome === "ok" ? parseJudgeOutput(report.output) : null;
  if (report.outcome !== "ok" || !judged) {
    const { error: releaseError } = await admin.rpc("learn_release_judgment", { p_id: jobId, p_token: report.claimToken });
    if (releaseError) throw releaseError;
    return json(200, { status: "pendiente" });
  }
  const { data: status, error: reportError } = await admin.rpc("learn_report_judgment", {
    p_id: jobId,
    p_token: report.claimToken,
    p_equivalent: judged.equivalent,
    p_reason: judged.reason,
    p_model: report.model ?? getServerEnv().AI_JUDGE_MODEL,
  });
  if (reportError) throw reportError;
  return json(200, { status: status ?? "ignorado" });
}

/**
 * Tras registrar la segunda opinión: el motor aprende (votos de la IA) y, si
 * AI_RELAY_SCORE, se registra la evaluación del motor con la IA relevándolo en lo
 * que dudó (pasa a ser la vigente: ranking, listados). Nunca hace fallar el
 * cierre del trabajo: la evaluación con IA ya quedó registrada.
 */
async function learnAndRelay(
  admin: AdminClient,
  input: { context: EvaluationContext; aiItems: ItemAssessment[]; rawOutput: unknown; evaluatedText: string; model: string | null },
): Promise<void> {
  try {
    const env = getServerEnv();
    const { context } = input;
    const learned = await loadActiveLearnedRules(admin, context.requirements);
    const referenceDate = new Date();
    const engineItems = evaluateWithRules(context.fullText, context.requirements, { referenceDate, learned });

    await recordEquivalenceVotes(admin, {
      candidateId: context.candidateId,
      applicationId: context.applicationId,
      requirements: context.requirements,
      engineItems,
      votes: extractEquivalenceVotes(input.rawOutput, context.requirements, input.evaluatedText),
      minConfirmations: env.AI_LEARN_MIN_CONFIRMATIONS,
    });

    if (!env.AI_RELAY_SCORE) return;
    const relayed = relayToAi(engineItems, input.aiItems);
    if (!hasRelayedItems(relayed)) return;
    const result = assembleEvaluation({
      method: "reglas",
      methodVersion: `${RULE_ENGINE_VERSION}+${PROMPT_VERSION}`,
      model: input.model,
      requirements: context.requirements,
      items: applyVerifications(relayed, await listVerifications(admin, context.applicationId)),
      textWasCorrected: context.textWasCorrected,
      textTruncated: false,
      signalNotes: detectEvaluationSignalNotes(context.fullText, context.vacancyText, referenceDate),
    });
    await recordAssembledEvaluation(admin, {
      applicationId: context.applicationId,
      resumeId: context.resumeId,
      criteriaVersion: context.criteriaVersion,
      result,
      inputSha256: createHash("sha256").update(context.fullText).digest("hex"),
      system: true,
    });
  } catch (error) {
    logServerError("ai_worker.learn_relay", error);
  }
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
      if (!job?.job_id || !job.application_id || !job.claim_token) {
        // Sin CV en cola: si hay una regla aprendida esperando al segundo juez, se entrega esa.
        const judgment = env.AI_LEARN_MIN_CONFIRMATIONS >= 1 ? await claimJudgment(admin, env.AI_JUDGE_MODEL) : null;
        return json(200, { job: judgment });
      }

      try {
        const context = await loadEvaluationContext(admin, job.application_id);
        const input = await inputFor(admin, context, env.AI_MAX_INPUT_CHARS);
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

    // ¿Es una tarea del segundo juez (regla aprendida) y no un CV?
    const judged = await reportJudgment(admin, jobId, report);
    if (judged) return judged;

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
    const input = await inputFor(admin, context, env.AI_MAX_INPUT_CHARS);
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

    // Lo que dijo la IA, antes de aplicar lo que verificó RRHH (para el relevo del motor).
    const aiItems = items;
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
      signalNotes: detectEvaluationSignalNotes(context.fullText, context.vacancyText, new Date()),
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
        ...(item.interviewQuestion ? { interview_question: item.interviewQuestion } : {}),
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
    await learnAndRelay(admin, { context, aiItems, rawOutput: report.output, evaluatedText: input.evaluatedText, model: result.model });
    return json(200, { status: "completado", evaluationId });
  } catch (error) {
    logServerError("ai_worker.report", error);
    const status = httpStatusOf(error);
    return json(status, { error: status === 500 ? "error_interno" : "solicitud_rechazada" });
  }
}
