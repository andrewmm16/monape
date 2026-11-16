/**
 * Calibración del ritmo del robot: horario de trabajo (para parecer una persona y
 * no actuar de madrugada) y variación de las pausas. Las horas son de Perú (UTC-5,
 * sin horario de verano).
 */

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;

export interface WorkSchedule {
  /** Franja horaria (hora de Perú); `null` = las 24 horas. Fin exclusivo. */
  hours: { start: number; end: number } | null;
  /** Días hábiles en ISO (1 = lunes … 7 = domingo); `null` = todos los días. */
  days: number[] | null;
}

/** ¿El robot puede trabajar en este instante, según su horario? */
export function withinWorkHours(now: Date, work: WorkSchedule): boolean {
  const lima = new Date(now.getTime() + LIMA_OFFSET_MS);
  if (work.days) {
    const iso = ((lima.getUTCDay() + 6) % 7) + 1; // domingo=0 → 7, lunes=1 …
    if (!work.days.includes(iso)) return false;
  }
  if (work.hours) {
    const hour = lima.getUTCHours();
    if (hour < work.hours.start || hour >= work.hours.end) return false;
  }
  return true;
}

/** Pausa base con una variación aleatoria de ±`jitter` (fracción 0-1), para no tener un ritmo mecánico. */
export function withJitter(baseMs: number, jitter: number, rnd: () => number = Math.random): number {
  if (jitter <= 0) return baseMs;
  return Math.round(baseMs * (1 + (rnd() * 2 - 1) * jitter));
}
