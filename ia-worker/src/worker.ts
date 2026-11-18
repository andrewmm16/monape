import { AppApiError, type AppApi } from "./api";
import { CliNotFoundError, type CliOutcome } from "./cli";
import type { Job, Report } from "./types";

/** Resultado de un paso del bucle. */
export type Step =
  | { kind: "idle" }
  | { kind: "done" }
  /** No reclamar más trabajos hasta `untilMs` (límite del plan, sesión inválida, CLI ausente). */
  | { kind: "pause"; untilMs: number; code: PauseCode; reason: string };

export type PauseCode = "limite_plan" | "sin_sesion" | "worker_no_disponible";

export type WorkerDeps = {
  api: AppApi;
  runModel: (job: Job) => Promise<CliOutcome>;
  log: (message: string) => void;
  now: () => number;
  /** Espera entre reintentos de envío del resultado. Inyectable para las pruebas. */
  sleep: (ms: number) => Promise<void>;
  modelOverride?: string;
};

/** Pausa si el ejecutable de Claude no está disponible. */
export const CLI_MISSING_PAUSE_MS = 5 * 60 * 1_000;
const REPORT_ATTEMPTS = 4;

function toReport(outcome: CliOutcome): Report {
  switch (outcome.kind) {
    case "ok":
      return { outcome: "ok", output: outcome.output, ...(outcome.model ? { model: outcome.model } : {}) };
    case "limit":
      return {
        outcome: "limite",
        errorCode: outcome.code,
        ...(outcome.retryAt ? { retryAt: new Date(outcome.retryAt).toISOString() } : {}),
      };
    case "error":
      return { outcome: "error", errorCode: outcome.code, retryable: outcome.retryable };
  }
}

/**
 * Envía el resultado con reintentos: si la app no responde, el trabajo del
 * modelo no se pierde por un corte breve. Si igual falla, la reserva vence en
 * 10 minutos y la app vuelve a entregar el trabajo.
 */
async function reportWithRetry(deps: WorkerDeps, job: Job, report: Report): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.api.report(job, report);
      return;
    } catch (error) {
      // 4xx: la app rechazó el resultado (p. ej. la reserva venció y otro worker tomó
      // el trabajo). Reintentar no lo arregla.
      if (error instanceof AppApiError && error.status !== null && error.status >= 400 && error.status < 500) {
        deps.log(`trabajo ${job.id}: la app rechazó el resultado (${error.status}); se descarta`);
        return;
      }
      if (attempt >= REPORT_ATTEMPTS) throw error;
      await deps.sleep(attempt * 5_000);
    }
  }
}

/** Reclama un trabajo, lo ejecuta con el CLI e informa el resultado. */
export async function processOnce(deps: WorkerDeps): Promise<Step> {
  const { job } = await deps.api.claim();
  if (!job) return { kind: "idle" };

  const model = deps.modelOverride ?? job.model;
  const started = deps.now();
  let outcome: CliOutcome;
  try {
    outcome = await deps.runModel({ ...job, model });
  } catch (error) {
    if (error instanceof CliNotFoundError) {
      // Problema del worker, no del trabajo: vuelve a la cola sin contar intento.
      await reportWithRetry(deps, job, {
        outcome: "limite",
        errorCode: "worker_no_disponible",
        retryAt: new Date(deps.now() + CLI_MISSING_PAUSE_MS).toISOString(),
      });
      return { kind: "pause", untilMs: deps.now() + CLI_MISSING_PAUSE_MS, code: "worker_no_disponible", reason: error.message };
    }
    outcome = { kind: "error", code: "cli_error", retryable: true, detail: error instanceof Error ? error.name : "error" };
  }

  const seconds = ((deps.now() - started) / 1_000).toFixed(1);
  await reportWithRetry(deps, job, toReport(outcome));

  if (outcome.kind === "ok") {
    deps.log(
      `trabajo ${job.id} (intento ${job.attempt}) listo en ${seconds} s con ${outcome.model ?? model}: ${outcome.usage.inputTokens} tokens de entrada, ${outcome.usage.outputTokens} de salida`,
    );
    return { kind: "done" };
  }
  if (outcome.kind === "limit") {
    const untilMs = outcome.retryAt ?? deps.now();
    const reason =
      outcome.code === "limite_plan"
        ? "se alcanzó el límite de uso del plan de Claude"
        : "Claude rechazó la sesión: renueve el token con «claude setup-token» (CLAUDE_CODE_OAUTH_TOKEN) o inicie sesión con «claude»";
    return { kind: "pause", untilMs, code: outcome.code, reason: `${reason} (${outcome.detail})` };
  }
  deps.log(`trabajo ${job.id} (intento ${job.attempt}) falló en ${seconds} s: ${outcome.code} (${outcome.detail})`);
  return { kind: "done" };
}
