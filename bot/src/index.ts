import { createAdapters } from "./adapters";
import { setAdapterLog } from "./adapters/fake-base";
import { BotApi } from "./api";
import { loadConfig } from "./config";
import { ERROR_CODES, WAITABLE } from "./errors";
import { FileIncidentStore } from "./incidents";
import { FilePublishJournal } from "./journal";
import { acquireLock } from "./lock";
import { BotControl } from "./notify/control";
import { dailySummaryMessage, dueDailySummary, limaDateKey } from "./notify/daily-summary";
import { DailySummaryState } from "./notify/daily-summary-state";
import { createIncomingHandler, incidentMessage } from "./notify/incoming";
import { createNotifier } from "./notify";
import { createRepairFromConfig, type RepairService } from "./repair";
import { TrialQueue, rehearseOnAdapter, type Rehearse } from "./repair/trial";
import { configureSelectorState, quitarAlternativasTolerantes } from "./selectors";
import { allStopped, createResumeSchedule, isResumable, isWaitingHuman, resumeDue, runResumeChecks, runRound, type AdapterSlot } from "./round";
import { createHealthSchedule, type Logger } from "./runner";
import { withinWorkHours } from "./schedule";
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
  if (reason === ERROR_CODES.consecutiveFailures) {
    return resumeMinutes > 0
      ? `${subject} (${reason}): varios trabajos seguidos fallaron al publicar o retirar. Cada ${resumeMinutes} min repito solo la prueba de estructura y, si pasa, lo reanudo UNA vez a prueba; si vuelve a fallar, necesitará a una persona.`
      : `${subject} (${reason}): varios trabajos seguidos fallaron (si ya se había reanudado una vez, vuelve a fallar). Revise el portal y el adaptador antes de reiniciar (npm run bot).`;
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

/** Aviso de relevo: el robot espera a que una persona resuelva la verificación en la ventana abierta y escriba «listo». */
function relevoMessage(reason: string, portal?: string): string {
  const subject = portal ? `El robot se detuvo en ${portal}` : "El robot se detuvo";
  const what =
    reason === ERROR_CODES.sessionExpired
      ? "la sesión del portal venció"
      : "el portal pide una verificación (un código)";
  return `${subject}: ${what}. Entra por acceso remoto a la PC del robot, resuélvelo en la ventana abierta (o inicia sesión) y escribe «listo». Sigo esperando; no hace falta reiniciar.`;
}

async function main() {
  const config = loadConfig();
  // Dónde se guardan los selectores aprobados y las tolerancias (ver selectors.ts).
  configureSelectorState({ overridesFile: config.selectorsFile, tolerancesFile: config.tolerancesFile, log });
  // Un solo robot a la vez: dos se pisan la cola de publicaciones y el perfil del navegador.
  const releaseLock = acquireLock(path.join(path.dirname(config.stateFile), "robot.lock"));
  // El log del robot también recoge la resolución de desafíos de verificación de los portales ficticios.
  setAdapterLog(log);
  // Un solo navegador para todos los portales: cada adaptador usa su propia pestaña.
  const { adapters, close } = await createAdapters(config);
  if (config.sinTolerancia) {
    // Demostración/pruebas: sin los selectores de respaldo, un renombrado del título obliga a la reparación por IA.
    for (const adapter of adapters) quitarAlternativasTolerantes(adapter.slug, "campo_titulo");
    log("(modo SIN TOLERANCIA) quitadas las alternativas de «campo_titulo»: un renombrado del título forzará la reparación por IA. Solo para demostración; no usar en producción.");
  }
  const control = new BotControl(config.adapter);
  const notifier = createNotifier(config, log);
  // Cada fallo con un portal queda guardado y se avisa una sola vez por incidente nuevo.
  // La reparación asistida (si hay ANTHROPIC_API_KEY) se crea más abajo; sin ella todo sigue igual que antes.
  let repair: RepairService | null = null;
  const incidents = new FileIncidentStore(config.incidentsDir, log, async (incident) => {
    // Si la reparación por IA va a enviar su aviso ÚNICO (consolidado), no mandamos el de «incidente» aquí.
    const esperaReparacion = repair !== null && incident.reparable && Boolean(incident.structure);
    if (!esperaReparacion) await notifier.notify(incidentMessage(incident, { repairActive: repair !== null }));
    // Sin esperar: la consulta al modelo no debe detener al robot (y nunca lanza).
    void repair?.handleNewIncident(incident);
  });
  const api = new BotApi(config.apiUrl, config.secret);
  const dailyState = new DailySummaryState(path.join(path.dirname(config.stateFile), "resumen-diario.json"));
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
      // Cada prueba de estructura verifica (o revierte) lo que la reparación asistida aplicó en ese portal.
      onHealthCheck: (ok, startedAt) => repair?.onHealthResult(adapter.slug, ok, startedAt),
      log,
      incidents,
      journal,
      pauseMs: config.pauseMs,
      pauseJitter: config.pauseJitter,
      maxJobs: config.maxJobsPerCycle,
    },
  }));
  const multi = slots.length > 1;

  // Los ensayos de propuestas usan el navegador compartido: se encolan y corren en el turno del robot (nunca en paralelo con un ciclo).
  const trials = new TrialQueue();
  const rehearse: Rehearse = (portal, clave, selector, step) =>
    trials.enqueue(async () => {
      const slot = slots.find((s) => s.slug === portal);
      return slot ? rehearseOnAdapter(slot.deps.adapter, clave, selector, step) : { resultado: "fallo", mensaje: `portal desconocido: ${portal}` };
    });
  repair = createRepairFromConfig(config, {
    rehearse,
    notify: (text) => notifier.notify(text),
    log,
    // Tras aplicar un selector, la comprobación del portal toca ya: la siguiente vuelta lo usa.
    onApplied: (portal) => {
      const slot = slots.find((s) => s.slug === portal);
      if (slot?.resume) slot.resume.lastCheckAt = null;
      if (slot?.deps.health) slot.deps.health.lastRunAt = null;
    },
  });
  const repairFuente =
    config.repairProvider === "openai"
      ? `servidor propio ${config.repairBaseUrl}`
      : config.repairProvider === "claude-cli"
        ? `suscripción vía ${config.repairCliPath}`
        : "Anthropic";
  log(
    repair
      ? `Reparación asistida activa (${repairFuente}, modelo ${config.repairModel}, hasta ${config.repairMaxPerDay} consultas al día).`
      : "Reparación asistida desactivada (sin ANTHROPIC_API_KEY, ni BOT_REPAIR_PROVIDER=openai/claude-cli, o con el tope diario en 0).",
  );

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Un fallo del canal de avisos nunca debe impedir que el robot trabaje.
  await notifier.start(createIncomingHandler(control, incidents, repair)).catch((error) => log(`Avisos desactivados: ${String(error)}`));

  log(`Robot iniciado (adaptador ${config.adapter}, cada ${config.pollSeconds} s).`);
  await notifier.notify(`Robot iniciado (adaptador ${config.adapter}). Envíe «ayuda» para ver las órdenes.`);
  let exitCode = 0;

  /** Comprobación de los portales detenidos por `pagina_cambio` (solo su prueba de estructura). Devuelve `true` si alguno volvió. */
  async function checkResumes(): Promise<boolean> {
    await trials.drain();
    const { resumed, escalated } = await runResumeChecks(slots, log, () => stopping, (slug, ok, startedAt) => repair?.onHealthResult(slug, ok, startedAt));
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

  /** Envía el resumen del día por WhatsApp una vez al día, a su hora (o al encender la PC si ya pasó). */
  async function maybeSendDailySummary(): Promise<void> {
    if (config.dailySummaryHour === null || !config.notifyPhone) return;
    const now = new Date();
    if (!dueDailySummary({ now, hour: config.dailySummaryHour, lastSentDate: dailyState.lastSent() })) return;
    try {
      const { linea } = await api.dailySummary();
      await notifier.notify(dailySummaryMessage(linea));
      dailyState.markSent(limaDateKey(now));
    } catch (error) {
      log(`No se pudo enviar el resumen diario: ${String(error)}`);
    }
  }

  /** Una persona avisó «listo»: reanuda los portales que esperaban una verificación. */
  function resumeAfterHuman(): void {
    if (!control.consumeRelevo()) return;
    const resumed: string[] = [];
    for (const slot of slots) {
      if (isWaitingHuman(slot)) {
        slot.halted = false;
        slot.haltReason = undefined;
        control.setHalted(slot.slug, null);
        resumed.push(slot.slug);
      }
    }
    if (resumed.length > 0) log(`Verificación resuelta por una persona: reanudo ${resumed.join(", ")}.`);
  }

  try {
    while (!stopping) {
      await maybeSendDailySummary();
      resumeAfterHuman();
      if (!control.paused && withinWorkHours(new Date(), config.work)) {
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
          if (halted.reason && WAITABLE.has(halted.reason)) {
            // Verificación o sesión vencida: el robot NO se reinicia; espera el «listo» de una persona.
            control.setHalted(halted.slug, halted.reason);
            const rest = multi && !allStopped(slots) ? " Los demás portales siguen trabajando." : "";
            log(`ESPERANDO VERIFICACIÓN${multi ? ` (${halted.slug})` : ""}: ${halted.reason}.`);
            await notifier.notify(relevoMessage(halted.reason, multi ? halted.slug : undefined) + rest);
            continue;
          }
          const resumable = isResumable(slot);
          control.setHalted(halted.slug, halted.reason ?? "", resumable);
          // La reparación por IA enviará UN aviso único con el cambio + la pausa; no dupliquemos con el «DETUVO».
          if (repair !== null && halted.reason === ERROR_CODES.pageChanged) {
            log(`DETENIDO${multi ? ` (${halted.slug})` : ""}: ${halted.reason} (aviso unificado por la reparación asistida).`);
            continue;
          }
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
        if (!control.paused && !stopping && trials.pending > 0) await trials.drain();
        if (!control.paused && !stopping && withinWorkHours(new Date(), config.work) && resumeDue(slots)) {
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
