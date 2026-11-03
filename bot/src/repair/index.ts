import type { BotConfig } from "../config";
import { sanitizeText, type Incident } from "../incidents";
import { getOverride, removeOverride, setOverride } from "../selectors";
import { askModel, createCompleteFromConfig, type Complete } from "./client";
import { buildPrompt, type RetryInput } from "./prompt";
import { ProposalStore, isApplicable, validateProposal, type Propuesta } from "./proposals";
import type { EnsayoResult, Rehearse } from "./trial";

/**
 * Reparación asistida por IA (todo opcional: sin `ANTHROPIC_API_KEY` no existe).
 *
 * Flujo: incidente nuevo reparable (con esquema) → se consulta al modelo SIN bloquear al robot →
 * ENSAYO: el selector propuesto se aplica solo en memoria y se ejecuta el `healthCheck()` del portal
 * (en el turno del robot, nunca en paralelo con un ciclo) → si pasa, se avisa «Propuesta PROBADA»; si falla,
 * se reintenta con el error del ensayo hasta `maxAttempts`; si se agotan, solo se avisa que no hay solución probada.
 * Si el paso que falló no lo cubre la prueba de estructura, se envía «SIN PROBAR» y se verifica tras aprobar.
 * «sí N» escribe el override en `selectores.json`; la siguiente comprobación lo verifica o lo revierte.
 * Una persona siempre decide; el modelo solo propone. Hacia el modelo salen únicamente el esquema ya saneado
 * y el mensaje saneado del incidente (y del ensayo), nunca postulantes ni CVs.
 */
export interface RepairOptions {
  complete: Complete;
  model: string;
  maxPerDay: number;
  verifyMinutes: number;
  /** Intentos máximos por incidente (1–5). */
  maxAttempts: number;
  /** Prueba un selector en el portal (pasa por la cola del robot). */
  rehearse: Rehearse;
  store: ProposalStore;
  notify: (text: string) => Promise<void> | void;
  log: (message: string) => void;
  now?: () => Date;
  /** Tras aplicar un override: permite adelantar la próxima comprobación del portal. */
  onApplied?: (portal: string) => void;
}

export type ApplyResult = { ok: true; propuesta: Propuesta } | { ok: false; motivo: string };

export interface RepairService {
  readonly verifyMinutes: number;
  /** Pide, prueba y (si pasa) propone la reparación de un incidente nuevo. No lanza nunca; el llamador no debe esperarla. */
  handleNewIncident(incident: Incident): Promise<void>;
  /** La propuesta del incidente (en cualquier estado), para consultarla. */
  get(incidentId: number): Promise<Propuesta | null>;
  /** La propuesta del incidente si sigue pendiente de decisión Y se puede aplicar (probada, o sin probar por no estar cubierta). */
  pending(incidentId: number): Promise<Propuesta | null>;
  apply(incidentId: number): Promise<ApplyResult>;
  reject(incidentId: number): Promise<Propuesta | null>;
  /** Resultado de la prueba de estructura de un portal (verifica o revierte lo aplicado). No lanza nunca. */
  onHealthResult(portal: string, ok: boolean, startedAt?: number): Promise<void>;
}

/** Si pasan más horas que estas entre el ensayo y la aprobación, se vuelve a ensayar antes de aplicar. */
export const STALE_TRIAL_HOURS = 24;

const oneLine = (text: string, max: number) => sanitizeText(text.replace(/[\r\n]+/g, " "), max);

type Shown = Pick<Propuesta, "incidenteId" | "selector" | "clave" | "confianza" | "razon" | "probada" | "ensayo">;

export function proposalMessage(p: Shown, verifyMinutes = 30): string {
  const n = p.incidenteId;
  const reason = oneLine(p.razon, 300).replace(/[.\s]+$/, "");
  if (p.probada) {
    return `Propuesta PROBADA para #${n}: usar «${p.selector}» como ${p.clave}; la prueba de estructura pasó con este cambio. Responda «sí ${n}» para aplicarla o «no ${n}» para rechazarla.`;
  }
  return `Propuesta SIN PROBAR (la prueba de estructura no cubre este paso) para #${n}: usar «${p.selector}» como ${p.clave} (confianza ${p.confianza}). Motivo: ${reason}. La verificación ocurrirá tras aprobarla: si la comprobación del portal falla dentro de ${verifyMinutes} min, se revierte sola. Responda «sí ${n}» para aplicarla o «no ${n}» para rechazarla.`;
}

export const exhaustedMessage = (incidentId: number, attempts: number) =>
  `No encontré una solución probada para #${incidentId} tras ${attempts} ${attempts === 1 ? "intento" : "intentos"}; hace falta revisar el adaptador.`;

export function createRepairService(options: RepairOptions): RepairService {
  const { complete, model, maxPerDay, verifyMinutes, maxAttempts, store, log, rehearse } = options;
  const now = options.now ?? (() => new Date());
  const notify = async (text: string) => {
    try {
      await options.notify(text);
    } catch (error) {
      log(`Reparación asistida: no se pudo avisar: ${oneLine(String(error), 200)}`);
    }
  };

  async function handleNewIncident(incident: Incident): Promise<void> {
    try {
      if (!incident.reparable || !incident.structure) return; // sin esquema no hay con qué proponer
      if (await store.get(incident.id)) return;

      let attempts = 0;
      let tokensEntrada = 0;
      let tokensSalida = 0;
      let retry: RetryInput | undefined;
      let last: Omit<Propuesta, "probada" | "ensayo" | "intentos" | "tokensEntrada" | "tokensSalida" | "modelo" | "estado"> | undefined;
      let lastTrial: EnsayoResult | undefined;
      let createdAt = "";

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!(await store.reserveQuery(maxPerDay))) {
          log(`Reparación asistida: se alcanzó el límite diario (${maxPerDay}); no se consulta más por el incidente #${incident.id}.`);
          break;
        }
        attempts = attempt;
        const { system, prompt } = buildPrompt({ incident, retry });
        const answer = await askModel(complete, { model, system, prompt });
        tokensEntrada += answer.tokensEntrada;
        tokensSalida += answer.tokensSalida;
        if (!answer.ok) {
          log(`Reparación asistida (#${incident.id}): sin propuesta: ${answer.motivo}.`);
          break;
        }
        const valid = validateProposal(incident.portal, answer.respuesta);
        if (!valid.ok) {
          log(`Reparación asistida (#${incident.id}): propuesta descartada: ${valid.motivo}.`);
          break;
        }
        if (retry && valid.selector === retry.selector && valid.clave === retry.clave) {
          log(`Reparación asistida (#${incident.id}): el modelo repitió el selector que ya falló; se detienen los intentos.`);
          break;
        }
        createdAt ||= now().toISOString();
        last = { incidenteId: incident.id, portal: incident.portal, clave: valid.clave, selector: valid.selector, confianza: answer.respuesta.confianza, razon: oneLine(answer.respuesta.razon, 300), creadaEn: createdAt };

        // ENSAYO: sin escribir nada; el override temporal lo retira quien lo aplica (try/finally).
        let trial: EnsayoResult;
        try {
          trial = await rehearse(incident.portal, valid.clave, valid.selector, incident.step);
        } catch (error) {
          trial = { resultado: "fallo", mensaje: oneLine(String(error instanceof Error ? error.message : error), 300) };
        }
        lastTrial = trial;
        log(`Reparación asistida (#${incident.id}): intento ${attempt}/${maxAttempts}, ensayo de «${valid.selector}» como ${valid.clave}: ${trial.resultado}.`);
        if (trial.resultado !== "fallo") break;
        retry = { attempt: attempt + 1, maxAttempts, clave: valid.clave, selector: valid.selector, mensaje: trial.mensaje, estructura: trial.estructura };
      }

      if (!last || !lastTrial) return; // el modelo no llegó a proponer nada utilizable: solo log
      const passed = lastTrial.resultado !== "fallo";
      const propuesta: Propuesta = {
        ...last,
        modelo: model,
        tokensEntrada,
        tokensSalida,
        estado: "propuesta",
        probada: lastTrial.resultado === "paso",
        intentos: attempts,
        ensayo: { resultado: lastTrial.resultado, mensaje: lastTrial.mensaje, en: now().toISOString() },
      };
      await store.save(propuesta);
      log(`Reparación asistida: propuesta guardada para el incidente #${incident.id} (${propuesta.portal}/${propuesta.clave}, ${propuesta.probada ? "probada" : passed ? "sin probar" : "NO probada"}, ${attempts} intento(s)).`);
      await notify(passed ? proposalMessage(propuesta, verifyMinutes) : exhaustedMessage(incident.id, attempts));
    } catch (error) {
      log(`Reparación asistida: falló la consulta del incidente #${incident.id}: ${oneLine(String(error instanceof Error ? error.message : error), 200)}`);
    }
  }

  const get = (incidentId: number) => store.get(incidentId);

  async function pending(incidentId: number): Promise<Propuesta | null> {
    const propuesta = await store.get(incidentId);
    return propuesta?.estado === "propuesta" && isApplicable(propuesta) ? propuesta : null;
  }

  async function apply(incidentId: number): Promise<ApplyResult> {
    const problem: { motivo?: string } = {};
    const before = await store.get(incidentId);
    try {
      // Una prueba de hace más de 24 h ya no vale: el portal pudo cambiar. Se vuelve a ensayar antes de aplicar.
      if (before && before.estado === "propuesta" && before.probada && now().getTime() - Date.parse(before.ensayo.en) > STALE_TRIAL_HOURS * 3_600_000) {
        let again: EnsayoResult;
        try {
          again = await rehearse(before.portal, before.clave, before.selector, "prueba_estructura");
        } catch (error) {
          again = { resultado: "fallo", mensaje: oneLine(String(error instanceof Error ? error.message : error), 300) };
        }
        if (again.resultado === "fallo") {
          await store.update(incidentId, () => ({ probada: false, ensayo: { resultado: "fallo", mensaje: again.mensaje, en: now().toISOString() } }));
          return { ok: false, motivo: `la prueba tiene más de ${STALE_TRIAL_HOURS} h y al repetirla ya no pasa (${again.mensaje})` };
        }
        await store.update(incidentId, () => ({ ensayo: { resultado: again.resultado, mensaje: again.mensaje, en: now().toISOString() } }));
      }
      const result = await store.update(incidentId, (p) => {
        if (p.estado !== "propuesta" || !isApplicable(p)) return null;
        const anterior = getOverride(p.portal, p.clave) ?? null;
        try {
          setOverride(p.portal, p.clave, { selector: p.selector, aprobadoEn: now().toISOString(), incidenteId: p.incidenteId });
        } catch (error) {
          problem.motivo = `no se pudo escribir el selector: ${oneLine(String(error instanceof Error ? error.message : error), 160)}`;
          return null;
        }
        return { estado: "aplicada", aplicadaEn: now().toISOString(), overrideAnterior: anterior };
      });
      if (problem.motivo) return { ok: false, motivo: problem.motivo };
      if (!result || result.estado !== "aplicada") return { ok: false, motivo: "no hay una propuesta aplicable para ese incidente" };
      try {
        options.onApplied?.(result.portal);
      } catch (error) {
        log(`Reparación asistida: falló el aviso de aplicación: ${oneLine(String(error), 200)}`);
      }
      log(`Reparación asistida: aplicado «${result.selector}» como ${result.portal}/${result.clave} (incidente #${incidentId}).`);
      return { ok: true, propuesta: result };
    } catch (error) {
      // No se pudo guardar el estado de la propuesta: se deja el override como estaba.
      if (before) {
        try {
          removeOverride(before.portal, before.clave, incidentId);
        } catch {
          // sin más: ya se informa el fallo
        }
      }
      return { ok: false, motivo: `no se pudo guardar la propuesta: ${oneLine(String(error instanceof Error ? error.message : error), 160)}` };
    }
  }

  async function reject(incidentId: number): Promise<Propuesta | null> {
    const result = await store.update(incidentId, (p) => (p.estado === "propuesta" ? { estado: "rechazada", rechazadaEn: now().toISOString() } : null));
    return result?.estado === "rechazada" ? result : null;
  }

  async function onHealthResult(portal: string, ok: boolean, startedAt: number = now().getTime()): Promise<void> {
    try {
      const applied = (await store.list()).filter((p) => p.portal === portal && p.estado === "aplicada" && !p.verificadaEn && p.aplicadaEn);
      for (const candidate of applied) {
        const appliedAt = Date.parse(candidate.aplicadaEn!);
        if (startedAt < appliedAt) continue; // la comprobación empezó antes de aplicar: no vio el override
        const within = now().getTime() - appliedAt <= verifyMinutes * 60_000;
        if (ok) {
          const done = await store.update(candidate.incidenteId, (p) => (p.estado === "aplicada" && !p.verificadaEn ? { verificadaEn: now().toISOString() } : null));
          if (done?.verificadaEn) {
            log(`Reparación asistida: el incidente #${done.incidenteId} quedó verificado (${done.portal}/${done.clave}).`);
            await notify(`Reparación aplicada y verificada: «${done.selector}» como ${done.clave} en ${done.portal} (incidente #${done.incidenteId}). La prueba de estructura pasó con el selector nuevo.`);
          }
        } else if (within) {
          const reverted = await store.update(candidate.incidenteId, (p) => {
            if (p.estado !== "aplicada" || p.verificadaEn) return null;
            // Solo se deshace lo propio: si otra decisión ya cambió ese selector, no se toca.
            if (getOverride(p.portal, p.clave)?.incidenteId === p.incidenteId) {
              if (p.overrideAnterior) setOverride(p.portal, p.clave, p.overrideAnterior);
              else removeOverride(p.portal, p.clave, p.incidenteId);
            }
            return { estado: "revertida", revertidaEn: now().toISOString(), motivoReversion: `la prueba de estructura falló dentro de ${verifyMinutes} min de aplicarla` };
          });
          if (reverted?.estado === "revertida") {
            log(`Reparación asistida: se revirtió el selector del incidente #${reverted.incidenteId} (${reverted.portal}/${reverted.clave}).`);
            await notify(`La reparación del incidente #${reverted.incidenteId} no superó la comprobación (${reverted.portal}): se revirtió «${reverted.selector}» como ${reverted.clave}. El portal necesita revisión manual.`);
          }
        }
      }
    } catch (error) {
      log(`Reparación asistida: falló la verificación de ${portal}: ${oneLine(String(error instanceof Error ? error.message : error), 200)}`);
    }
  }

  return { verifyMinutes, handleNewIncident, get, pending, apply, reject, onHealthResult };
}

/**
 * Crea el servicio solo si la reparación está activa (`ANTHROPIC_API_KEY`, o `BOT_REPAIR_PROVIDER=openai` con su
 * servidor); si no, `null` y el robot se comporta exactamente como antes. `complete` se inyecta en las pruebas.
 */
export function createRepairFromConfig(
  config: Pick<BotConfig, "repairEnabled" | "repairProvider" | "repairBaseUrl" | "repairJsonMode" | "repairTimeoutSeconds" | "repairModel" | "repairMaxPerDay" | "repairVerifyMinutes" | "repairMaxAttempts" | "proposalsDir">,
  deps: Pick<RepairOptions, "notify" | "log" | "onApplied" | "now" | "rehearse"> & { complete?: Complete },
): RepairService | null {
  if (!config.repairEnabled) return null;
  return createRepairService({
    complete: deps.complete ?? createCompleteFromConfig(config),
    model: config.repairModel,
    maxPerDay: config.repairMaxPerDay,
    verifyMinutes: config.repairVerifyMinutes,
    maxAttempts: config.repairMaxAttempts,
    rehearse: deps.rehearse,
    store: new ProposalStore(config.proposalsDir, deps.now),
    notify: deps.notify,
    log: deps.log,
    onApplied: deps.onApplied,
    now: deps.now,
  });
}
