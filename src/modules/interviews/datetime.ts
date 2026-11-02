/**
 * Fechas y horas de las entrevistas. La interfaz trabaja en hora de Perú
 * (America/Lima, UTC−5, sin horario de verano); la base guarda timestamptz.
 * Todo es puro: no depende del servidor ni del navegador.
 */

const TIME_ZONE = "America/Lima";
const LIMA_OFFSET = "-05:00";
const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Fecha (aaaa-mm-dd) y hora (hh:mm) de Lima → ISO con -05:00; null si no son válidas. */
export function limaToIso(date: string, time: string): string | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  // Rechaza fechas inexistentes (30 de febrero).
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${date}T${time}:00${LIMA_OFFSET}`;
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

function limaParts(value: Date): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = Object.fromEntries(partsFormatter.formatToParts(value).map((p) => [p.type, p.value]));
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour!, minute: parts.minute! };
}

/** Instante → fecha (aaaa-mm-dd) y hora (hh:mm) de Lima. */
export function isoToLima(value: string | Date): { date: string; time: string } {
  const p = limaParts(typeof value === "string" ? new Date(value) : value);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Día civil de Lima (aaaa-mm-dd) de un instante. */
export function limaDayKey(value: string | Date): string {
  return isoToLima(value).date;
}

/** ¿El instante ya pasó? */
export function isPast(value: string, now: Date = new Date()): boolean {
  return new Date(value).getTime() < now.getTime();
}

const weekdayFormatter = new Intl.DateTimeFormat("es-PE", { weekday: "long", timeZone: TIME_ZONE });

/** «Hoy», «Mañana» o «miércoles 30/10» según el día de Lima. */
export function dayLabel(value: string | Date, now: Date = new Date()): string {
  const key = limaDayKey(value);
  if (key === limaDayKey(now)) return "Hoy";
  if (key === limaDayKey(new Date(now.getTime() + DAY_MS))) return "Mañana";
  const date = typeof value === "string" ? new Date(value) : value;
  const p = limaParts(date);
  return `${weekdayFormatter.format(date)} ${p.day}/${p.month}`;
}

export type DayGroup<T> = { key: string; label: string; items: T[] };

/** Agrupa por día de Lima conservando el orden de entrada (ya debe venir cronológico). */
export function groupByDay<T extends { scheduled_at: string }>(items: readonly T[], now: Date = new Date()): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const key = limaDayKey(item.scheduled_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.scheduled_at, now), items: [item] });
  }
  return groups;
}

const timeFormatter = new Intl.DateTimeFormat("es-PE", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

/** Hora de Lima (hh:mm). */
export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

const dateTimeFormatter = new Intl.DateTimeFormat("es-PE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});

/** Fecha y hora de Lima para mostrar. */
export function formatInterviewDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

/** Duración legible: «45 min», «1 h», «1 h 30 min». */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** El texto es un enlace http(s) válido: se devuelve normalizado; si no, null. */
export function safeHttpUrl(text: string | null | undefined): string | null {
  const value = text?.trim();
  if (!value || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
