import "server-only";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import { httpStatusOf, json } from "@/modules/portal-bot/auth";
import {
  buildDeepDivePrompt,
  DEEP_DIVE_JSON_SCHEMA,
  DEEP_DIVE_PROMPT_VERSION,
  DEEP_DIVE_SYSTEM_PROMPT,
  parseDeepDiveOutput,
  type DeepDivePromptItem,
} from "./ai/deep-dive-prompt";
import { contextErrorCode, loadEvaluationContext } from "./context";
import { confirmItemsWithoutAi, selectDeepDiveItems } from "./deep-dive";
import type { GuideItemInput } from "./interview-guide";
import { loadGuideItems } from "./interview-guide-data";

/**
 * Preguntas para profundizar en la cola del worker de IA (tercer tipo de tarea,
 * después de los CV y antes del segundo juez). Igual que las otras: la app arma
 * el prompt y valida la salida; el worker solo transporta.
 */

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Lo que recibe el worker (mismo formato que una evaluación de CV o un juicio). */
export type WorkerTask = {
  id: string;
  claimToken: string;
  attempt: number;
  model: string;
  effort: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
};

/** Lo que informa el worker (el cuerpo validado de /api/ia/trabajos/[id]/resultado). */
export type DeepDiveReport =
  | { outcome: "ok"; claimToken: string; output?: unknown; model?: string }
  | { outcome: "limite"; claimToken: string; errorCode: string; retryAt?: string }
  | { outcome: "error"; claimToken: string; errorCode: string; retryable: boolean };

/** Reservas que se intentan preparar por reclamo antes de responder «sin trabajo». */
const MAX_PREPARE_ATTEMPTS = 5;

async function release(
  admin: AdminClient,
  id: string,
  token: string,
  outcome: "reintentar" | "limite" | "reprogramar" | "error",
  errorCode: string | null = null,
  retryAt: string | null = null,
): Promise<string> {
  const { data, error } = await admin.rpc("deep_dive_release", {
    p_id: id,
    p_token: token,
    p_outcome: outcome,
    p_error_code: errorCode ?? undefined,
    p_retry_at: retryAt ?? undefined,
  });
  if (error) throw error;
  return data ?? "pendiente";
}

function promptItem(item: GuideItemInput, note: string | null): DeepDivePromptItem {
  return {
    id: item.requirementId,
    description: item.description,
    category: item.category,
    priority: item.priority,
    minYears: item.minYears,
    isEssential: item.isEssential,
    quotes: item.evidence.map((evidence) => evidence.quote),
    note,
  };
}

/** Arma la tarea de una reserva, o la cierra (y devuelve null) si no hay nada que pedir a la IA. */
async function prepare(
  admin: AdminClient,
  job: { deep_dive_id: string; application_id: string; attempts: number; claim_token: string },
  opts: { model: string; effort: string; maxChars: number },
): Promise<WorkerTask | null> {
  const id = job.deep_dive_id;
  const token = job.claim_token;
  const context = await loadEvaluationContext(admin, job.application_id);
  const { data: application, error } = await admin
    .from("applications")
    .select("id, vacancy_id, latest_evaluation_id")
    .eq("id", job.application_id)
    .maybeSingle();
  if (error) throw error;
  const bundle = application ? (await loadGuideItems(admin, [application])).get(application.id) : undefined;
  // Las citas deben ser del mismo CV y criterios que se envían: si no, primero hay que volver a evaluar.
  if (!bundle || bundle.resumeId !== context.resumeId || bundle.criteriaVersion !== context.criteriaVersion) {
    await release(admin, id, token, "error", "evaluacion_desactualizada");
    return null;
  }

  const deepen = selectDeepDiveItems(bundle.items);
  const confirm = confirmItemsWithoutAi(bundle.items);
  if (deepen.length + confirm.length === 0) {
    await release(admin, id, token, "error", "sin_preguntas");
    return null;
  }
  const byId = new Map(bundle.items.map((item) => [item.requirementId, item]));
  const { userMessage, requestedItems } = buildDeepDivePrompt({
    vacancyTitle: context.vacancyTitle,
    fullText: context.fullText,
    maxChars: opts.maxChars,
    deepen: deepen.map((item) => promptItem(item, null)),
    confirm: confirm.flatMap((question) => {
      const item = byId.get(question.requirementId);
      return item ? [promptItem(item, question.reason)] : [];
    }),
  });

  const { error: startError } = await admin.rpc("deep_dive_start", {
    p_id: id,
    p_token: token,
    p_evaluation_id: bundle.evaluationId,
    // Puede ser null (evaluación sin CV asociado): la función lo acepta.
    p_resume_id: bundle.resumeId as string,
    p_criteria_version: bundle.criteriaVersion,
    p_requested_items: requestedItems as Json,
  });
  if (startError) throw startError;

  return {
    id,
    claimToken: token,
    attempt: job.attempts,
    model: opts.model,
    effort: opts.effort,
    system: DEEP_DIVE_SYSTEM_PROMPT,
    prompt: userMessage,
    schema: DEEP_DIVE_JSON_SCHEMA,
  };
}

/** Reserva y prepara la siguiente tarea de preguntas, o null si no hay. */
export async function claimDeepDive(
  admin: AdminClient,
  opts: { model: string; effort: string; maxChars: number },
): Promise<WorkerTask | null> {
  for (let i = 0; i < MAX_PREPARE_ATTEMPTS; i++) {
    const { data, error } = await admin.rpc("deep_dive_claim");
    if (error) throw error;
    const job = data?.[0];
    if (!job?.deep_dive_id || !job.application_id || !job.claim_token) return null;
    try {
      const task = await prepare(
        admin,
        { deep_dive_id: job.deep_dive_id, application_id: job.application_id, attempts: Math.max(1, job.attempts ?? 1), claim_token: job.claim_token },
        opts,
      );
      if (task) return task;
    } catch (prepareError) {
      const code = contextErrorCode(prepareError);
      if (code) {
        await release(admin, job.deep_dive_id, job.claim_token, "error", code);
      } else {
        logServerError("ai_worker.deep_dive_prepare", prepareError);
        await release(admin, job.deep_dive_id, job.claim_token, "reintentar", "error_preparacion");
      }
    }
  }
  return null;
}

/**
 * Resultado de una tarea de preguntas, o null si `id` no es una (sigue el flujo
 * del juez y de los CV). Con «ok» y una salida válida se guardan; si no, se
 * libera la reserva con las mismas reglas que una evaluación.
 */
export async function reportDeepDive(admin: AdminClient, id: string, report: DeepDiveReport): Promise<Response | null> {
  const { data: row, error } = await admin
    .from("interview_deep_dives")
    .select("id")
    .eq("id", id)
    .eq("claim_token", report.claimToken)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const token = report.claimToken;

  if (report.outcome === "limite") {
    return json(200, { status: await release(admin, id, token, "limite", report.errorCode, report.retryAt ?? null) });
  }
  if (report.outcome === "error") {
    return json(200, { status: await release(admin, id, token, report.retryable ? "reintentar" : "error", report.errorCode) });
  }

  const questions = parseDeepDiveOutput(report.output);
  if (!questions) return json(200, { status: await release(admin, id, token, "reintentar", "respuesta_invalida") });

  const { data: saved, error: completeError } = await admin.rpc("deep_dive_complete", {
    p_id: id,
    p_token: token,
    p_questions: questions.map((q) => ({
      requirement_id: q.requirementId,
      kind: q.kind,
      question: q.question,
      listen_for: q.listenFor ?? "",
    })) as Json,
    p_model: report.model ?? getServerEnv().AI_MODEL,
    p_prompt_version: DEEP_DIVE_PROMPT_VERSION,
  });
  if (completeError) {
    // Ninguna pregunta correspondía a lo pedido: se reintenta (cuenta intento).
    if (httpStatusOf(completeError) === 422) {
      return json(200, { status: await release(admin, id, token, "reintentar", "respuesta_invalida") });
    }
    throw completeError;
  }
  return json(200, { status: "completado", saved });
}
