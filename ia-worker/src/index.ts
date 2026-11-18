import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { AppApiError, createAppApi, type WorkerState } from "./api";
import { buildChildEnv, runClaude } from "./cli";
import { loadConfig } from "./config";
import { processOnce, type WorkerDeps } from "./worker";

/**
 * Worker de evaluaciones con IA: reclama trabajos de la app, los ejecuta con
 * el CLI oficial de Claude Code (suscripción vía OAuth) y devuelve la salida.
 * Uso: npm run ia:worker  (configuración en .env.ia-worker; ver ia-worker/README.md)
 */

function log(message: string): void {
  console.log(`[ia-worker ${new Date().toISOString()}] ${message}`);
}

/** Comprueba que el CLI se puede ejecutar y devuelve su versión. */
function checkCli(cliPath: string): string {
  const result = spawnSync(cliPath, ["--version"], { encoding: "utf8", windowsHide: true, env: buildChildEnv(), timeout: 60_000 });
  if (result.error || result.status !== 0) {
    throw new Error(
      `no se pudo ejecutar «${cliPath} --version»: instale Claude Code (npm install -g @anthropic-ai/claude-code) o configure IA_WORKER_CLI_PATH`,
    );
  }
  const version = result.stdout.trim().slice(0, 100);
  log(`CLI de Claude: ${version}`);
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    log("CLAUDE_CODE_OAUTH_TOKEN no está definido: se usará la sesión iniciada con «claude» en esta máquina.");
  }
  return version;
}

/** Cada cuánto el worker avisa que sigue vivo (la app lo da por caído a los 3 min sin noticias). */
const HEARTBEAT_MS = 60_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const cliVersion = checkCli(config.cliPath);
  const api = createAppApi({ appUrl: config.appUrl, secret: config.secret });

  let stopping = false;
  let pauseUntil = 0;
  let state: WorkerState = { state: "activo", cliVersion };
  let statusFailing = false;

  /** Envía el estado actual. Un fallo se registra una vez (la app puede estar caída). */
  async function sendStatus(): Promise<void> {
    if (state.state === "pausado" && Date.now() >= pauseUntil) state = { state: "activo", cliVersion };
    try {
      await api.status(state);
      if (statusFailing) log("la app vuelve a recibir el estado del worker");
      statusFailing = false;
    } catch (error) {
      if (!statusFailing) log(`no se pudo enviar el estado a la app: ${error instanceof Error ? error.message : "error"}`);
      statusFailing = true;
    }
  }
  await sendStatus();
  const heartbeat = setInterval(() => void sendStatus(), HEARTBEAT_MS);

  const stop = () => {
    if (stopping) process.exit(1); // Segunda señal: salir ya.
    stopping = true;
    clearInterval(heartbeat);
    log("deteniendo: se termina el trabajo en curso (Ctrl+C otra vez para salir ya)");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const deps: WorkerDeps = {
    api,
    runModel: (job) => runClaude(job, { cliPath: config.cliPath, timeoutMs: config.timeoutMs }),
    log,
    now: Date.now,
    sleep: (ms) => sleep(ms),
    modelOverride: config.modelOverride,
  };

  /** Espera en tramos cortos para responder rápido a la señal de detención. */
  async function wait(ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (!stopping && Date.now() < end) await sleep(Math.min(1_000, end - Date.now()));
  }

  async function loop(slot: number): Promise<void> {
    let failures = 0;
    while (!stopping) {
      if (Date.now() < pauseUntil) {
        await wait(Math.min(pauseUntil - Date.now(), 30_000));
        continue;
      }
      try {
        const step = await processOnce(deps);
        failures = 0;
        if (step.kind === "idle") await wait(config.pollMs);
        if (step.kind === "pause" && step.untilMs > pauseUntil) {
          pauseUntil = step.untilMs;
          state = { state: "pausado", reason: step.code, until: new Date(pauseUntil).toISOString(), cliVersion };
          log(`en pausa hasta ${new Date(pauseUntil).toLocaleString()}: ${step.reason}`);
          await sendStatus();
        }
      } catch (error) {
        // App caída o sin red: espera creciente (máx. 5 min) y sigue.
        failures++;
        const delay = Math.min(5 * 60_000, config.pollMs * 2 ** Math.min(failures, 6));
        const detail = error instanceof AppApiError || error instanceof Error ? error.message : "error";
        log(`[${slot}] ${detail}; reintento en ${Math.round(delay / 1_000)} s`);
        await wait(delay);
      }
    }
  }

  log(`atendiendo ${config.appUrl} con ${config.concurrency} proceso(s) en paralelo`);
  await Promise.all(Array.from({ length: config.concurrency }, (_, i) => loop(i + 1)));
  clearInterval(heartbeat);
  log("detenido");
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
