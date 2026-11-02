import { createAdapters } from "./adapters";
import { BotApi } from "./api";
import { loadConfig } from "./config";
import { ERROR_CODES } from "./errors";
import { FileIncidentStore } from "./incidents";
import { FilePublishJournal } from "./journal";
import { acquireLock } from "./lock";
import { BotControl } from "./notify/control";
import { createIncomingHandler, incidentMessage } from "./notify/incoming";
import { createNotifier } from "./notify";
import { allStopped, createResumeSchedule, isResumable, resumeDue, runResumeChecks, runRound, type AdapterSlot } from "./round";
import { createHealthSchedule, type Logger } from "./runner";
import { FileSeenStore } from "./seen";
import path from "node:path";

const log: Logger = (message) => console.log(`[${new Date().toISOString()}] ${message}`);

/** Tras este número de ciclos fallidos seguidos se avisa una sola vez (suele ser la app o la red). */
const NOTIFY_AFTER_CYCLE_FAILURES = 3;

function haltMessage(reason: string | undefined, portal?: string, resumeMinutes = 0): string {
  const session = reason === ERROR_CODES.sessionExpired || reason === ERROR_CODES.verificationRequired;
  const subject = portal ? `El robot se DETUVO en ${portal}` : "El robot se DETUVO";
  if (reason === ERROR_CODES.browserClosed) {
    return `${subject} (${reason}): el navegador del robot se cerró. No es un cambio del portal. Reinicie el robot (npm run bot) y no cierre su ventana.`;
  }
  if (reason === ERROR_CODES.appUnavailable) {
    return `${subject} (${reason}): no pude informar a la app el resultado de una publicación. No es un cambio del portal: revise que la app responda y reinicie el robot (npm run bot). El diario evita que se publique dos veces.`;
  }
  if (reason === ERROR_CODES.portalUnreachable && resumeMinutes > 0) {
    return `${subject} (${reason}): el portal no respondió (caído o sin conexión). No es un cambio de su página. Cada ${resumeMinutes} min repito solo la prueba de estructura y, cuando el portal vuelva, lo reanudo y se lo aviso.`;
  }
  if (reason === ERROR_CODES.pageChanged && resumeMinutes > 0) {
    return `${subject} (${reason}): el portal parece haber cambiado. Cada ${resumeMinutes} min repito solo la prueba de estructura (sin publicar ni retirar nada) y, si vuelve a pasar, lo reanudo y se lo aviso. Si no vuelve a la normalidad, hay que revisar el adaptador.`;
  }
  return session
    ? `${subject} (${reason}): necesita a una persona. En la PC del robot: npm run bot:login y luego npm run bot.`
    : `${subject} (${reason ?? "motivo desconocido"}): el portal parece haber cambiado. Hay que revisar el adaptador antes de reiniciar (npm run bot).`;
}

async function main() {
  const config = loadConfig();
  // Un solo robot a la vez: dos se pisan la cola de publicaciones y el perfil del navegador.
  const releaseLock = acquireLock(path.join(path.dirname(config.stateFile), "robot.lock"));
  // Un solo navegador para todos los portales: cada adaptador usa su propia pestaña.
  const { adapters, close } = await createAdapters(config);
  const control = new BotControl(config.adapter);
  const notifier = createNotifier(config, log);
  // Cada fallo con un portal queda guardado y se avisa una sola vez por incidente nuevo.
  const incidents = new FileIncidentStore(config.incidentsDir, log, (incident) => notifier.notify(incidentMessage(incident)));
  const api = new BotApi(config.apiUrl, config.secret);
  // Un solo registro de enviados para todos (los ids de publicación son únicos entre portales).
  const seen = new FileSeenStore(config.stateFile);
  // Lo publicado y aún no informado: sin esto, un reintento publicaría la misma oferta dos veces.
  const journal = new FilePublishJournal(config.journalFile, log);
  const slots: AdapterSlot[] = adapters.map((adapter) => ({
    slug: adapter.slug,
    halted: false,
    // Un portal detenido por `pagina_cambio` se reanuda solo cuando su prueba de estructura vuelve a pasar.
    resume: config.resumeCheckMinutes > 0 ? createResumeSchedule(config.resumeCheckMinutes) : undefined,
    deps: {
      api,
      adapter,
      seen,
      // Cada portal con su propio calendario de prueba de estructura.
      health: config.healthCheckHours > 0 ? createHealthSchedule(config.healthCheckHours) : undefined,
      log,
      incidents,
      journal,
      pauseMs: config.pauseMs,
      maxJobs: config.maxJobsPerCycle,
    },
  }));
  const multi = slots.length > 1;

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Un fallo del canal de avisos nunca debe impedir que el robot trabaje.
  await notifier.start(createIncomingHandler(control, incidents)).catch((error) => log(`Avisos desactivados: ${String(error)}`));

  log(`Robot iniciado (adaptador ${config.adapter}, cada ${config.pollSeconds} s).`);
  await notifier.notify(`Robot iniciado (adaptador ${config.adapter}). Envíe «ayuda» para ver las órdenes.`);
  let exitCode = 0;

  /** Comprobación de los portales detenidos por `pagina_cambio` (solo su prueba de estructura). Devuelve `true` si alguno volvió. */
  async function checkResumes(): Promise<boolean> {
    const { resumed, escalated } = await runResumeChecks(slots, log, () => stopping);
    for (const slug of resumed) {
      control.autoResumes += 1;
      control.setHalted(slug, null);
      await notifier.notify(`${slug} se reanudó: la prueba de estructura volvió a pasar.`);
    }
    for (const { slug, reason } of escalated) {
      control.setHalted(slug, reason);
      await notifier.notify(haltMessage(reason, multi ? slug : undefined));
    }
    return resumed.length > 0;
  }

  try {
    while (!stopping) {
      if (!control.paused) {
        await checkResumes();
        if (allStopped(slots)) {
          exitCode = 2;
          break;
        }
        const round = await runRound(slots, log, () => stopping);
        if (round.failed) {
          // La app no respondió u otro fallo del ciclo: se reintenta en el siguiente.
          control.consecutiveCycleFailures += 1;
          control.recordCycle(round.summary);
          if (control.consecutiveCycleFailures === NOTIFY_AFTER_CYCLE_FAILURES) {
            await notifier.notify(
              `El robot lleva ${NOTIFY_AFTER_CYCLE_FAILURES} ciclos fallidos seguidos (¿la app o la red no responden?). Sigue reintentando.`,
            );
          }
        } else {
          if (control.consecutiveCycleFailures >= NOTIFY_AFTER_CYCLE_FAILURES) {
            await notifier.notify("El robot volvió a funcionar con normalidad.");
          }
          control.consecutiveCycleFailures = 0;
          control.recordCycle(round.summary);
        }
        for (const halted of round.newlyHalted) {
          const slot = slots.find((s) => s.slug === halted.slug)!;
          const resumable = isResumable(slot);
          control.setHalted(halted.slug, halted.reason ?? "", resumable);
          const rest = multi && !round.allHalted ? " Los demás portales siguen trabajando." : "";
          const next = resumable
            ? `Se comprobará solo cada ${config.resumeCheckMinutes} min si el portal vuelve a la normalidad.`
            : "Una persona debe revisar el portal y reiniciar el robot.";
          log(`DETENIDO${multi ? ` (${halted.slug})` : ""}: ${halted.reason}. ${next}${rest}`);
          await notifier.notify(haltMessage(halted.reason, multi ? halted.slug : undefined, resumable ? config.resumeCheckMinutes : 0) + rest);
        }
        if (round.allHalted) {
          exitCode = 2;
          break;
        }
      }
      for (let waited = 0; waited < config.pollSeconds && !stopping && !control.consumeWake(); waited++) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        // Un portal detenido por `pagina_cambio` se comprueba a su hora aunque falte para el siguiente ciclo.
        if (!control.paused && !stopping && resumeDue(slots)) {
          const back = await checkResumes();
          if (allStopped(slots)) break;
          if (back) break; // vuelve a trabajar sin esperar el resto de la pausa
        }
      }
      if (!control.paused && allStopped(slots)) {
        exitCode = 2;
        break;
      }
    }
  } finally {
    await close();
    await notifier.stop();
    releaseLock();
  }
  log("Robot detenido.");
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
