/**
 * Resumen diario por WhatsApp. La frase ya viene redactada desde la app
 * (`/api/bot/resumen-diario`); aquí solo se decide CUÁNDO enviarla y se le
 * pone un encabezado. Perú no usa horario de verano: siempre UTC-5.
 */

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** Fecha local de Lima como «YYYY-MM-DD» (clave para saber si ya se envió hoy). */
export function limaDateKey(now: Date): string {
  const lima = new Date(now.getTime() + LIMA_OFFSET_MS);
  return `${lima.getUTCFullYear()}-${pad(lima.getUTCMonth() + 1)}-${pad(lima.getUTCDate())}`;
}

function limaHour(now: Date): number {
  return new Date(now.getTime() + LIMA_OFFSET_MS).getUTCHours();
}

/**
 * ¿Toca enviar el resumen ahora? Sí cuando no se ha enviado hoy y ya llegó la
 * hora. Así, si la PC estaba apagada a esa hora, se envía UNA vez en cuanto se
 * encienda ese día (no se repite ni se pierde).
 */
export function dueDailySummary(opts: { now: Date; hour: number; lastSentDate: string | null }): boolean {
  if (opts.lastSentDate === limaDateKey(opts.now)) return false;
  return limaHour(opts.now) >= opts.hour;
}

/** Encabezado + la frase redactada por la app. */
export function dailySummaryMessage(linea: string): string {
  return `📋 Resumen del robot\n${linea}`;
}
