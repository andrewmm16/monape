import { WAITABLE } from "../errors";
import type { Command } from "./commands";

/**
 * Estado que las órdenes de mensajería pueden cambiar. El bucle principal lo
 * consulta; las órdenes no saltan las detenciones por una verificación o la sesión vencida
 * (si el robot se detuvo, el proceso termina y no queda a quién ordenar).
 */
export class BotControl {
  paused = false;
  private wakeRequested = false;
  private relevoRequested = false;
  lastCycleAt: Date | null = null;
  lastOutcome: string | null = null;
  consecutiveCycleFailures = 0;
  /** Reanudaciones automáticas de portales (detenidos por `pagina_cambio`) desde que arrancó el robot. */
  autoResumes = 0;
  private halted = new Map<string, { reason: string; resumable: boolean }>();

  constructor(
    private readonly adapterName: string,
    private readonly startedAt: Date = new Date(),
  ) {}

  /** Anota (o quita, con `reason = null`) un portal detenido, para la orden «estado». */
  setHalted(slug: string, reason: string | null, resumable = false) {
    if (reason === null) this.halted.delete(slug);
    else this.halted.set(slug, { reason: reason || "motivo desconocido", resumable });
  }

  /** Devuelve `true` (una sola vez) si se pidió un ciclo inmediato. */
  consumeWake(): boolean {
    const requested = this.wakeRequested;
    this.wakeRequested = false;
    return requested;
  }

  /** Devuelve `true` (una sola vez) si una persona avisó «listo» para reanudar las verificaciones en espera. */
  consumeRelevo(): boolean {
    const requested = this.relevoRequested;
    this.relevoRequested = false;
    return requested;
  }

  recordCycle(outcome: string, now: Date = new Date()) {
    this.lastCycleAt = now;
    this.lastOutcome = outcome;
  }

  /** Aplica la orden y devuelve la respuesta a enviar. Solo ids y estados, nunca datos de postulantes. */
  handle(command: Command): string {
    switch (command) {
      case "estado": {
        const lines = [
          `Robot (${this.adapterName}): ${this.paused ? "EN PAUSA" : "activo"}.`,
          `Iniciado: ${this.startedAt.toLocaleString("es-PE")}.`,
          this.lastCycleAt
            ? `Último ciclo: ${this.lastCycleAt.toLocaleString("es-PE")} (${this.lastOutcome ?? "sin detalle"}).`
            : "Aún no termina ningún ciclo.",
        ];
        if (this.consecutiveCycleFailures > 0) lines.push(`Ciclos fallidos seguidos: ${this.consecutiveCycleFailures}.`);
        if (this.halted.size > 0) {
          const list = [...this.halted].map(([slug, h]) => {
            const extra = WAITABLE.has(h.reason) ? ", esperando «listo»" : h.resumable ? ", se comprueba solo" : "";
            return `${slug} (${h.reason}${extra})`;
          });
          lines.push(`Portales detenidos: ${list.join(", ")}.`);
        }
        if (this.autoResumes > 0) lines.push(`Reanudaciones automáticas: ${this.autoResumes}.`);
        return lines.join("\n");
      }
      case "pausar":
        this.paused = true;
        return "Listo: el robot queda en pausa (no publicará ni revisará postulantes). Envíe «reanudar» para continuar.";
      case "reanudar":
        this.paused = false;
        this.wakeRequested = true;
        return "Listo: el robot continúa y hará un ciclo ahora.";
      case "ahora":
        if (this.paused) return "El robot está en pausa. Envíe «reanudar» primero.";
        this.wakeRequested = true;
        return "Listo: hará un ciclo en unos segundos.";
      case "listo": {
        const pending = [...this.halted].filter(([, h]) => WAITABLE.has(h.reason)).map(([slug]) => slug);
        if (pending.length === 0) {
          return "No hay ninguna verificación pendiente. Si resolviste algo en la ventana del robot, no hace falta avisar.";
        }
        this.relevoRequested = true;
        this.wakeRequested = true;
        return `Gracias. Reanudo ${pending.join(", ")} y hago un ciclo ahora.`;
      }
      case "ayuda":
        return [
          "Órdenes disponibles:",
          "estado: cómo está el robot",
          "pausar: detiene los ciclos",
          "reanudar: continúa",
          "ahora: hace un ciclo sin esperar",
          "listo: continúa tras resolver una verificación/sesión en la ventana del robot (puede ser por acceso remoto)",
        ].join("\n");
    }
  }
}
