import { ERROR_CODES, HUMAN_REQUIRED, errorCodeOf } from "./errors";
import { sanitizeText } from "./incidents";
import { reportStatus, runCycle, type Logger, type RunnerDeps } from "./runner";

/** Cada cuánto se reintenta un portal detenido por `pagina_cambio` (solo con su prueba de estructura). */
export interface ResumeSchedule {
  intervalMs: number;
  /** Última comprobación (o el momento en que se detuvo el portal). */
  lastCheckAt: number | null;
  /** Comprobaciones fallidas desde que se detuvo; solo la primera se anota en el log. */
  failedChecks: number;
  now(): number;
}

export function createResumeSchedule(intervalMinutes: number, now: () => number = Date.now): ResumeSchedule {
  return { intervalMs: intervalMinutes * 60_000, lastCheckAt: null, failedChecks: 0, now };
}

/** Un portal dentro del robot: su ciclo, y si ya se detuvo esperando a una persona. */
export interface AdapterSlot {
  slug: string;
  deps: RunnerDeps;
  halted: boolean;
  haltReason?: string;
  /** Sin esto un portal detenido no se reanuda solo (comportamiento anterior). */
  resume?: ResumeSchedule;
}

export interface RoundResult {
  /** Algún portal no pudo completar su ciclo (la app o la red no respondieron). */
  failed: boolean;
  /** Texto corto para el estado del robot. Con un solo portal: «correcto», «fallido» o «detenido: motivo». */
  summary: string;
  /** Portales que se detuvieron en esta vuelta. */
  newlyHalted: { slug: string; reason?: string }[];
  /** Ya no queda ningún portal activo ni reanudable: el robot debe terminar. */
  allHalted: boolean;
}

/** Motivos de parada que la prueba de estructura puede revertir sin una persona: la página cambió y se restableció, o el portal volvió. */
const RESUMABLE_REASONS = new Set<string>([ERROR_CODES.pageChanged, ERROR_CODES.portalUnreachable]);

/** Detenido por `pagina_cambio` o `portal_no_disponible` y con reanudación automática: la prueba de estructura puede devolverlo al trabajo. */
export const isResumable = (slot: AdapterSlot): boolean =>
  slot.halted && slot.haltReason !== undefined && RESUMABLE_REASONS.has(slot.haltReason) && slot.resume !== undefined;

/** Todos detenidos y ninguno reanudable: solo una persona puede seguir (el robot termina con código 2). */
export const allStopped = (slots: AdapterSlot[]): boolean => slots.every((slot) => slot.halted && !isResumable(slot));

/**
 * Una vuelta del robot: un `runCycle` por cada portal no detenido, en orden y uno
 * a la vez (comparten navegador, cada uno con su pestaña). Si uno se detiene
 * (CAPTCHA, sesión vencida, portal cambiado) se marca y los demás siguen; un fallo
 * pasajero (la app no responde) no detiene a nadie y se reintenta en la vuelta siguiente.
 */
export async function runRound(slots: AdapterSlot[], log: Logger, shouldStop: () => boolean = () => false): Promise<RoundResult> {
  const multi = slots.length > 1;
  let failed = false;
  const outcomes: string[] = [];
  const newlyHalted: RoundResult["newlyHalted"] = [];

  for (const slot of slots) {
    if (slot.halted || shouldStop()) continue;
    let outcome: string;
    try {
      const result = await runCycle(slot.deps);
      if (result.halted) {
        slot.halted = true;
        slot.haltReason = result.reason;
        if (isResumable(slot)) {
          slot.resume!.lastCheckAt = slot.resume!.now();
          slot.resume!.failedChecks = 0;
        }
        newlyHalted.push({ slug: slot.slug, reason: result.reason });
        outcome = `detenido: ${result.reason}`;
      } else {
        outcome = "correcto";
      }
    } catch (error) {
      failed = true;
      outcome = "fallido";
      log(`Ciclo fallido${multi ? ` (${slot.slug})` : ""}: ${error instanceof Error ? error.message : String(error)}`);
    }
    outcomes.push(multi ? `${slot.slug}: ${outcome}` : outcome);
  }

  return {
    failed,
    summary: outcomes.join("; ") || "sin portales activos",
    newlyHalted,
    allHalted: allStopped(slots),
  };
}

export interface ResumeResult {
  /** Portales que volvieron al trabajo. */
  resumed: string[];
  /** Portales cuya comprobación reveló un motivo que exige a una persona (sesión vencida, navegador cerrado…). */
  escalated: { slug: string; reason: string }[];
}

async function notifyCheck(onCheck: Parameters<typeof runResumeChecks>[3], log: Logger, slug: string, ok: boolean, startedAt: number): Promise<void> {
  try {
    await onCheck?.(slug, ok, startedAt);
  } catch (error) {
    log(`Comprobación de ${slug}: falló el aviso del resultado: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Hay algún portal reanudable cuya comprobación ya toca. */
export function resumeDue(slots: AdapterSlot[]): boolean {
  return slots.some((slot) => isResumable(slot) && (slot.resume!.lastCheckAt === null || slot.resume!.now() - slot.resume!.lastCheckAt >= slot.resume!.intervalMs));
}

/**
 * Comprobación de los portales detenidos por `pagina_cambio` cuya hora llegó: SOLO su
 * `healthCheck()` (no envía ni cambia nada; no se publica ni se retira nada). Si pasa, el
 * portal se reanuda y la app lo ve «activo»; si falla, sigue detenido sin aviso (solo la
 * primera vez queda en el log). Corre en el mismo hilo que las vueltas, así que nunca
 * coincide con un ciclo en el navegador compartido. Un fallo que exige a una persona
 * (sesión, navegador cerrado) deja de ser reanudable y se devuelve en `escalated`.
 */
export async function runResumeChecks(
  slots: AdapterSlot[],
  log: Logger,
  shouldStop: () => boolean = () => false,
  /** Resultado de cada prueba de estructura (salvo las que exigen a una persona): la reparación asistida verifica o revierte con él. Nunca debe lanzar. */
  onCheck?: (slug: string, ok: boolean, startedAt: number) => Promise<void> | void,
): Promise<ResumeResult> {
  const result: ResumeResult = { resumed: [], escalated: [] };
  for (const slot of slots) {
    const schedule = slot.resume;
    if (shouldStop()) break;
    if (!schedule || !isResumable(slot)) continue;
    if (schedule.lastCheckAt !== null && schedule.now() - schedule.lastCheckAt < schedule.intervalMs) continue;
    schedule.lastCheckAt = schedule.now();
    const startedAt = Date.now();
    try {
      await slot.deps.adapter.healthCheck();
    } catch (error) {
      const code = errorCodeOf(error);
      if (!HUMAN_REQUIRED.has(code)) await notifyCheck(onCheck, log, slot.slug, false, startedAt);
      if (HUMAN_REQUIRED.has(code)) {
        slot.haltReason = code;
        result.escalated.push({ slug: slot.slug, reason: code });
        log(`Comprobación de ${slot.slug}: ahora necesita a una persona (${code}).`);
      } else if (schedule.failedChecks++ === 0) {
        log(`Comprobación de ${slot.slug}: la prueba de estructura sigue fallando (${sanitizeText(error instanceof Error ? error.message : String(error), 200)}). Se reintenta cada ${schedule.intervalMs / 60_000} min sin más avisos.`);
      }
      continue;
    }
    await notifyCheck(onCheck, log, slot.slug, true, startedAt);
    slot.halted = false;
    slot.haltReason = undefined;
    schedule.failedChecks = 0;
    // La prueba acaba de pasar: no hace falta repetirla en el siguiente ciclo.
    if (slot.deps.health) slot.deps.health.lastRunAt = slot.deps.health.now();
    await reportStatus(slot.deps, "activo");
    try {
      await slot.deps.incidents?.recover?.(slot.slug, "El robot reanudó el portal: la prueba de estructura volvió a pasar (comprobación automática).");
    } catch (error) {
      log(`No se pudo anotar la recuperación de ${slot.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
    log(`Portal ${slot.slug} reanudado: la prueba de estructura volvió a pasar.`);
    result.resumed.push(slot.slug);
  }
  return result;
}
