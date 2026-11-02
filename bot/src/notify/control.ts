import type { Command } from "./commands";

/**
 * Estado que las órdenes de mensajería pueden cambiar. El bucle principal lo
 * consulta; las órdenes no saltan las detenciones por CAPTCHA o sesión vencida
 * (si el robot se detuvo, el proceso termina y no queda a quién ordenar).
 */
export class BotControl {
  paused = false;
  private wakeRequested = false;
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
          const list = [...this.halted].map(([slug, h]) => `${slug} (${h.reason}${h.resumable ? ", se comprueba solo" : ""})`);
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
      case "ayuda":
        return [
          "Órdenes disponibles:",
          "estado: cómo está el robot",
          "pausar: detiene los ciclos",
          "reanudar: continúa",
          "ahora: hace un ciclo sin esperar",
          "Un CAPTCHA, código o sesión vencida se resuelve en la PC del robot, no por aquí.",
        ].join("\n");
    }
  }
}
