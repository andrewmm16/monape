import type { BotApiLike } from "./api";
import { ApiError, ERROR_CODES, HUMAN_REQUIRED, PortalError, errorCodeOf } from "./errors";
import { sanitizeText, type IncidentRecorder, type IncidentStep } from "./incidents";
import type { PublishJournal } from "./journal";
import type { SeenStore } from "./seen";
import type { ActivePublication, Job, PortalAdapter, ReportBody } from "./types";

/** Solo ids y conteos: nunca nombres, correos ni teléfonos de postulantes. */
export type Logger = (message: string) => void;

/** Cada cuánto se hace la prueba de estructura del portal (por defecto una vez al día). */
export interface HealthSchedule {
  intervalMs: number;
  /** `null` = aún no se ha hecho: se hace en el primer ciclo. */
  lastRunAt: number | null;
  now(): number;
}

export function createHealthSchedule(intervalHours: number, now: () => number = Date.now): HealthSchedule {
  return { intervalMs: intervalHours * 3_600_000, lastRunAt: null, now };
}

export interface RunnerDeps {
  api: BotApiLike;
  adapter: PortalAdapter;
  seen: SeenStore;
  /** Sin esto no se hace la prueba de estructura. */
  health?: HealthSchedule;
  log: Logger;
  /** Si se da, cada fallo con el portal queda guardado como incidente para diagnosticarlo. */
  incidents?: IncidentRecorder;
  /** Ofertas ya publicadas cuyo resultado aún no se informó; evita publicar dos veces al reintentar. */
  journal?: PublishJournal;
  /** Resultado de la prueba de estructura periódica (salvo si exige a una persona): la reparación asistida verifica o revierte con él. Nunca debe lanzar. */
  onHealthCheck?: (ok: boolean, startedAt: number) => Promise<void> | void;
  /** Pausa entre acciones en el portal. */
  pauseMs: number;
  maxJobs: number;
}

export interface CycleResult {
  /** `true` si el robot debe detenerse hasta que una persona intervenga. */
  halted: boolean;
  reason?: string;
}

/** Tras este número de fallos seguidos se detiene: probablemente el portal cambió. */
const MAX_CONSECUTIVE_FAILURES = 2;
const REPORT_ATTEMPTS = 3;

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

class ReportFailedError extends Error {}

/** Un rechazo definitivo de la app (4xx, salvo «reintente»): repetir el mismo informe no cambia nada. */
function isDefinitiveRejection(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/**
 * Informa el resultado a la app. Un fallo pasajero (app caída, red) se reintenta
 * y, si no se logra, lanza: hay que detenerse, porque seguir podría publicar dos
 * veces la misma oferta (el diario evita el duplicado, pero no hay razón para
 * seguir con la app caída). Un rechazo definitivo de la app no detiene al robot:
 * queda como incidente y se devuelve «rechazado».
 */
async function reportOrThrow(deps: RunnerDeps, job: Job, body: ReportBody): Promise<"ok" | "rechazado"> {
  const detail = body.outcome === "publicada" ? ` Oferta ya creada en el portal: ${body.externalUrl}` : "";
  for (let attempt = 1; attempt <= REPORT_ATTEMPTS; attempt++) {
    try {
      await deps.api.report(job.publicationId, body);
      return "ok";
    } catch (error) {
      deps.log(`No se pudo informar la publicación ${job.publicationId} (intento ${attempt}): ${describe(error)}`);
      if (isDefinitiveRejection(error)) {
        deps.log(`ATENCIÓN: la app no aceptó el resultado de ${job.publicationId}.${detail}`);
        await recordIncident(
          deps,
          job.action === "retirar" ? "retirar" : "publicar",
          new PortalError(
            ERROR_CODES.resultRejected,
            `La app no aceptó el resultado «${body.outcome}» de la publicación ${job.publicationId} (${describe(error)}).${detail}`,
          ),
          job.publicationId,
        );
        return "rechazado";
      }
      await sleep(attempt * 1_000);
    }
  }
  deps.log(`ATENCIÓN: no se registró el resultado de ${job.publicationId}.${detail}`);
  throw new ReportFailedError(ERROR_CODES.appUnavailable);
}

/** Mensaje de un error para el registro: sin correos, teléfonos ni parámetros de enlaces. */
function describe(error: unknown): string {
  return sanitizeText(error instanceof Error ? error.message : String(error), 300);
}

/** Guarda el fallo como incidente (no lanza nunca). */
async function recordIncident(deps: RunnerDeps, step: IncidentStep, error: unknown, publicationId?: string): Promise<void> {
  await deps.incidents?.record({
    portal: deps.adapter.slug,
    step,
    error,
    publicationId,
    captureStructure: deps.adapter.captureStructure ? () => deps.adapter.captureStructure!() : undefined,
  });
}

async function perform(deps: RunnerDeps, job: Job): Promise<ReportBody> {
  if (job.action === "retirar") {
    // Sin id en la app puede haberse guardado en el diario (se cerró la vacante mientras se publicaba).
    const externalId = job.externalId ?? deps.journal?.get(job.publicationId)?.externalId;
    if (!externalId) {
      deps.log(`Retiro de ${job.publicationId} sin id de la oferta: no se retira a ciegas.`);
      await recordIncident(
        deps,
        "retirar",
        new PortalError(
          ERROR_CODES.withdrawWithoutId,
          "Se pidió retirar una oferta cuyo id no se conoce (la vacante se cerró mientras se publicaba). Revise en el portal si quedó publicada.",
        ),
        job.publicationId,
      );
      return { outcome: "retirada" };
    }
    // Última revisión de postulantes ANTES de retirar: una vez retirada, la app deja de pedir esta oferta
    // y quien postuló desde el ciclo anterior se perdería. Si no se trae todo, no se retira (se reintenta).
    const last = await syncPublication(deps, { publicationId: job.publicationId, externalId, externalUrl: null, lastSyncedAt: null });
    if (last.halted) throw new PortalError(last.reason ?? ERROR_CODES.pageChanged, "No se pudo revisar los postulantes antes de retirar la oferta.");
    if (last.gone) {
      deps.log(`La oferta de ${job.publicationId} ya no existe en el portal: no hay nada que retirar.`);
      return { outcome: "retirada" };
    }
    if (!last.complete) {
      throw new PortalError(last.failCode ?? ERROR_CODES.finalSyncIncomplete, "No se trajeron todos los postulantes antes de retirar la oferta; se reintenta para no perderlos.");
    }
    await deps.adapter.withdraw(externalId);
    return { outcome: "retirada" };
  }

  // Ya se publicó en un intento anterior y no se pudo informar: se reenvía, no se vuelve a publicar.
  const saved = deps.journal?.get(job.publicationId);
  if (saved) {
    deps.log(`La oferta de ${job.publicationId} ya estaba publicada en el portal: se reenvía el resultado guardado.`);
    return { outcome: "publicada", ...saved };
  }
  const { externalId, externalUrl } = await deps.adapter.publish(job.vacancy);
  try {
    deps.journal?.set(job.publicationId, { externalId, externalUrl });
  } catch (error) {
    deps.log(`ATENCIÓN: no se pudo guardar en el diario la oferta de ${job.publicationId} (${externalUrl}): ${describe(error)}`);
  }
  return { outcome: "publicada", externalId, externalUrl };
}

/** Atiende la cola: publica y retira ofertas hasta que no queden trabajos. */
export async function processQueue(deps: RunnerDeps): Promise<CycleResult> {
  let failures = 0;
  try {
    for (let done = 0; done < deps.maxJobs; done++) {
      const job = await deps.api.claim(deps.adapter.slug);
      if (!job) return { halted: false };

      let body: ReportBody;
      try {
        body = await perform(deps, job);
      } catch (error) {
        body = { outcome: "error", errorCode: errorCodeOf(error) };
        deps.log(`Falló ${job.action} de ${job.publicationId}: ${describe(error)}`);
        await recordIncident(deps, job.action === "retirar" ? "retirar" : "publicar", error, job.publicationId);
      }
      const delivered = await reportOrThrow(deps, job, body);
      deps.journal?.remove(job.publicationId);
      if (delivered === "rechazado") {
        await sleep(deps.pauseMs);
        continue;
      }

      if (body.outcome === "error") {
        failures++;
        if (HUMAN_REQUIRED.has(body.errorCode)) return { halted: true, reason: body.errorCode };
        if (failures >= MAX_CONSECUTIVE_FAILURES) return { halted: true, reason: ERROR_CODES.consecutiveFailures };
      } else {
        failures = 0;
        deps.log(`${job.action === "retirar" ? "Retirada" : "Publicada"} ${job.publicationId}`);
      }
      await sleep(deps.pauseMs);
    }
    return { halted: false };
  } catch (error) {
    if (error instanceof ReportFailedError) return { halted: true, reason: error.message };
    throw error;
  }
}

/** Resultado de revisar los postulantes de UNA oferta. */
interface SyncOutcome {
  /** Algo exige a una persona: el robot debe detenerse. */
  halted: boolean;
  reason?: string;
  /** Se trajeron todos los postulantes nuevos (no quedó ninguno por fallo del portal). */
  complete?: boolean;
  /** La oferta ya no existe en el portal. */
  gone?: boolean;
  /** Código del primer fallo con el portal, si lo hubo. */
  failCode?: string;
}

/** Cada cuánto se vuelve a mirar una oferta que no se encontró en el portal. */
const GONE_RETRY_MS = 60 * 60_000;

/** Ofertas «no encontradas» por robot: se saltan hasta la hora indicada, para no esperar en vano en cada ciclo. */
const goneOffers = new WeakMap<RunnerDeps, Map<string, number>>();

/** Trae los postulantes nuevos de UNA oferta y los entrega a la app. */
async function syncPublication(deps: RunnerDeps, publication: ActivePublication): Promise<SyncOutcome> {
    let applicants;
    try {
      applicants = await deps.adapter.listApplicants(publication);
    } catch (error) {
      const code = errorCodeOf(error);
      deps.log(`No se pudo leer la oferta ${publication.publicationId}: ${describe(error)}`);
      await recordIncident(deps, "leer_postulantes", error, publication.publicationId);
      if (HUMAN_REQUIRED.has(code)) return { halted: true, reason: code };
      return { halted: false, complete: false, gone: code === ERROR_CODES.offerNotFound, failCode: code };
    }

    let complete = true;
    let failCode: string | undefined;
    let sent = 0;
    for (const applicant of applicants) {
      if (deps.seen.has(publication.publicationId, applicant.externalId)) continue;
      // Solo lo que falla con el PORTAL es un incidente del adaptador. Si falla la app,
      // el error sube y el ciclo se reintenta completo: no tiene sentido seguir bajando CV.
      let resume;
      try {
        resume = await deps.adapter.downloadResume(publication, applicant);
      } catch (error) {
        complete = false;
        const code = errorCodeOf(error);
        failCode ??= code;
        deps.log(`No se pudo traer un postulante de ${publication.publicationId}: ${describe(error)}`);
        await recordIncident(deps, "descargar_cv", error, publication.publicationId);
        if (HUMAN_REQUIRED.has(code)) return { halted: true, reason: code };
        continue;
      }

      const status = await deps.api.sendApplicant(publication.publicationId, applicant, resume);
      if (status === "cerrada") {
        deps.log(`La vacante de ${publication.publicationId} ya no recibe postulantes.`);
        break;
      }
      if (status === "invalida") {
        // La app lo rechazó (correo, nombre o archivo no válidos): se avisa para que RRHH lo revise en el portal.
        deps.log(`La app rechazó los datos de un postulante de la oferta ${publication.publicationId}.`);
        await recordIncident(
          deps,
          "descargar_cv",
          new PortalError(
            ERROR_CODES.resultRejected,
            `La app rechazó los datos del postulante con id externo ${applicant.externalId} de la oferta ${publication.publicationId} (correo, nombre o archivo no válidos). Revíselo en el portal.`,
          ),
          publication.publicationId,
        );
      } else {
        sent++;
      }
      try {
        deps.seen.add(publication.publicationId, applicant.externalId);
      } catch (error) {
        // Es solo una optimización: la app deduplica. No debe contarse como fallo del postulante.
        deps.log(`No se pudo guardar el registro de enviados: ${describe(error)}`);
      }
      await sleep(deps.pauseMs);
    }

    if (complete) await deps.api.markSynced(publication.publicationId);
    if (sent > 0) deps.log(`Oferta ${publication.publicationId}: ${sent} postulante(s) nuevo(s).`);
    return { halted: false, complete, failCode };
}

/** Trae los postulantes nuevos de las ofertas activas y los entrega a la app. */
export async function syncApplicants(deps: RunnerDeps): Promise<CycleResult> {
  const publications = await deps.api.active(deps.adapter.slug);
  const skipped = goneOffers.get(deps) ?? new Map<string, number>();
  goneOffers.set(deps, skipped);

  for (const publication of publications) {
    if (!publication.externalId) continue;
    // Publicada a mano por RRHH: no es del robot (su código no existe en la pestaña del robot y daría falsos «oferta no encontrada»).
    if (publication.manual === true) continue;
    const retryAt = skipped.get(publication.publicationId);
    if (retryAt !== undefined && Date.now() < retryAt) continue;

    const outcome = await syncPublication(deps, publication);
    if (outcome.halted) return { halted: true, reason: outcome.reason };
    if (outcome.gone) {
      skipped.set(publication.publicationId, Date.now() + GONE_RETRY_MS);
      deps.log(`La oferta ${publication.publicationId} ya no existe en el portal: se deja de revisar por ${GONE_RETRY_MS / 60_000} min.`);
    } else {
      skipped.delete(publication.publicationId);
    }
  }
  return { halted: false };
}

/** Avisa a la app el estado del robot; si la app no responde, solo queda en el log. */
export async function reportStatus(deps: RunnerDeps, state: "activo" | "necesita_persona", reason?: string): Promise<void> {
  try {
    await deps.api.reportStatus(deps.adapter.slug, state, reason);
  } catch (error) {
    deps.log(`No se pudo informar el estado del robot: ${describe(error)}`);
  }
}

const HEALTH_ATTEMPTS = 2;

async function notifyHealth(deps: RunnerDeps, ok: boolean, startedAt: number): Promise<void> {
  try {
    await deps.onHealthCheck?.(ok, startedAt);
  } catch (error) {
    deps.log(`No se pudo avisar el resultado de la prueba de estructura: ${describe(error)}`);
  }
}

/**
 * Prueba de estructura del portal, si toca. Si falla (dos intentos, por si fue
 * la red), el robot se detiene ANTES de tocar la cola: con la página cambiada,
 * publicar podría hacerlo mal. Devuelve `null` si no tocaba o si pasó.
 */
async function runHealthCheckIfDue(deps: RunnerDeps): Promise<CycleResult | null> {
  const schedule = deps.health;
  if (!schedule) return null;
  if (schedule.lastRunAt !== null && schedule.now() - schedule.lastRunAt < schedule.intervalMs) return null;

  let code = "";
  let lastError: unknown;
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++) {
    try {
      await deps.adapter.healthCheck();
      schedule.lastRunAt = schedule.now();
      deps.log("Prueba de estructura del portal: correcta.");
      await notifyHealth(deps, true, startedAt);
      const gaps = deps.adapter.healthCheckGaps?.() ?? [];
      if (gaps.length > 0) deps.log(`Prueba de estructura: quedó sin cubrir (no hay datos en el portal): ${gaps.join(", ")}.`);
      return null;
    } catch (error) {
      code = errorCodeOf(error);
      lastError = error;
      deps.log(`Prueba de estructura del portal fallida (intento ${attempt}): ${describe(error)}`);
      if (HUMAN_REQUIRED.has(code)) break;
      await sleep(attempt * 1_000);
    }
  }
  if (!HUMAN_REQUIRED.has(code)) await notifyHealth(deps, false, startedAt);
  await recordIncident(deps, "prueba_estructura", lastError);
  return { halted: true, reason: code };
}

/**
 * Un ciclo completo: primero la cola de publicaciones, luego los postulantes.
 * Al terminar avisa a la app si sigue activo o si se detuvo esperando a una
 * persona, para que RRHH lo vea en pantalla.
 */
export async function runCycle(deps: RunnerDeps): Promise<CycleResult> {
  let result = (await runHealthCheckIfDue(deps)) ?? (await processQueue(deps));
  if (!result.halted) result = await syncApplicants(deps);
  if (result.halted) await reportStatus(deps, "necesita_persona", result.reason);
  else await reportStatus(deps, "activo");
  return result;
}
