/**
 * Plazos y pasos de la política de incidentes (docs/politica-incidentes.md).
 * Todo es puro: recibe los datos y la hora actual, no toca la base ni el reloj.
 */

export type IncidentSeverity = "alta" | "media" | "baja";
export type IncidentStatus = "abierto" | "contenido" | "cerrado";
export type IncidentEventKind = "accion" | "notificacion" | "nota";

export const AUTHORITY_NAME = "Autoridad Nacional de Protección de Datos Personales";
export const NOTIFY_HOURS = 48;
/** Por debajo de estas horas el plazo se muestra en rojo. */
export const URGENT_HOURS = 12;
export const REVIEW_BUSINESS_DAYS = 5;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LIMA_OFFSET_MS = -5 * HOUR_MS;

export type DeadlineIncident = {
  severity: IncidentSeverity;
  isDrill: boolean;
  affectedData: string;
  detectedAt: string;
};

export type DeadlineEvent = { kind: IncidentEventKind; recipient: string | null };

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** ¿Es una notificación a la Autoridad? (el destinatario es texto libre, con la opción del formulario como valor habitual). */
export function isAuthorityRecipient(recipient: string | null | undefined): boolean {
  if (!recipient) return false;
  const text = normalize(recipient);
  return text.includes("autoridad nacional de proteccion de datos") || text === "anpd";
}

export type NotificationDeadline = {
  /** ¿La política exige avisar a la Autoridad? (gravedad alta o media, o datos afectados indicados). */
  applies: boolean;
  /** Simulacro: se calcula igual, pero es práctica. */
  practice: boolean;
  dueAt: Date;
  /** Horas que faltan (negativas si ya venció). Se detiene cuando se cumple. */
  hoursRemaining: number;
  overdue: boolean;
  fulfilled: boolean;
  /** Rojo: sin cumplir y vencido o con menos de 12 h. */
  urgent: boolean;
};

export function notificationDeadline(
  incident: DeadlineIncident,
  events: readonly DeadlineEvent[],
  now: Date = new Date(),
): NotificationDeadline {
  const applies = incident.severity !== "baja" || incident.affectedData.trim() !== "";
  const dueAt = new Date(new Date(incident.detectedAt).getTime() + NOTIFY_HOURS * HOUR_MS);
  const fulfilled = events.some((event) => event.kind === "notificacion" && isAuthorityRecipient(event.recipient));
  const hoursRemaining = (dueAt.getTime() - now.getTime()) / HOUR_MS;
  const overdue = hoursRemaining <= 0;
  return {
    applies,
    practice: incident.isDrill,
    dueAt,
    hoursRemaining,
    overdue,
    fulfilled,
    urgent: applies && !fulfilled && hoursRemaining < URGENT_HOURS,
  };
}

/** «quedan 5 h 20 min», «quedan 35 min» o «venció hace 3 h». */
export function describeHours(hoursRemaining: number): string {
  const totalMinutes = Math.floor(Math.abs(hoursRemaining) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const text = hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
  return hoursRemaining > 0 ? `quedan ${text}` : `venció hace ${text}`;
}

// --- Revisión posterior ------------------------------------------------------

/** Día civil de Lima (UTC−5, sin horario de verano) como fecha UTC a medianoche. */
function limaCivilDay(value: Date): Date {
  const shifted = new Date(value.getTime() + LIMA_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/**
 * Suma días hábiles (lunes a viernes) a un día civil.
 * PENDIENTE: no descuenta los feriados de Perú (hoy solo se saltan sábados y domingos).
 */
export function addBusinessDays(day: Date, count: number): Date {
  const result = new Date(day.getTime());
  let left = count;
  while (left > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = result.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return result;
}

export type ReviewDeadline = {
  /** Solo gravedad media o alta y con el incidente cerrado. */
  applies: boolean;
  /** Último día para hacerla (aaaa-mm-dd, día civil de Lima). */
  dueDate: string | null;
  done: boolean;
  overdue: boolean;
  /** Días corridos que faltan (negativos si ya pasó). */
  daysRemaining: number | null;
};

export function reviewDeadline(
  incident: { severity: IncidentSeverity; closedAt: string | null; reviewDoneAt: string | null },
  now: Date = new Date(),
): ReviewDeadline {
  const done = incident.reviewDoneAt !== null;
  if (incident.severity === "baja" || !incident.closedAt) {
    return { applies: false, dueDate: null, done, overdue: false, daysRemaining: null };
  }
  const due = addBusinessDays(limaCivilDay(new Date(incident.closedAt)), REVIEW_BUSINESS_DAYS);
  const daysRemaining = Math.round((due.getTime() - limaCivilDay(now).getTime()) / DAY_MS);
  return {
    applies: true,
    dueDate: due.toISOString().slice(0, 10),
    done,
    overdue: !done && daysRemaining < 0,
    daysRemaining,
  };
}

// --- Los 6 pasos de la política ----------------------------------------------

export const INCIDENT_STEP_KEYS = ["contener", "preservar", "evaluar", "notificar", "recuperar", "cerrar"] as const;
export type IncidentStepKey = (typeof INCIDENT_STEP_KEYS)[number];

export const INCIDENT_STEP_LABELS: Record<IncidentStepKey, string> = {
  contener: "Contener",
  preservar: "Preservar la evidencia",
  evaluar: "Evaluar el alcance",
  notificar: "Notificar",
  recuperar: "Recuperar",
  cerrar: "Cerrar y aprender",
};

export type IncidentStep = {
  key: IncidentStepKey;
  label: string;
  state: "hecho" | "pendiente" | "no_aplica";
  detail: string;
};

export type StepsIncident = DeadlineIncident & {
  status: IncidentStatus;
  affectedPeople: number | null;
  closedAt: string | null;
  reviewDoneAt: string | null;
};

/**
 * Los pasos se derivan del estado y de la bitácora, sin que nadie los marque:
 *  - Contener: el estado pasó a «contenido» o «cerrado».
 *  - Preservar la evidencia: hay al menos una acción anotada en la bitácora.
 *  - Evaluar el alcance: se indicaron los datos afectados y cuántas personas (0 si ninguna).
 *  - Notificar: hay notificaciones; si la política no exige avisar, «no aplica».
 *  - Recuperar: el incidente está cerrado (no se cierra sin causa y prevención).
 *  - Cerrar y aprender: cerrado y, si corresponde, con la revisión registrada.
 */
export function incidentSteps(incident: StepsIncident, events: readonly DeadlineEvent[], now: Date = new Date()): IncidentStep[] {
  const notified = events.some((event) => event.kind === "notificacion");
  const hasAction = events.some((event) => event.kind === "accion");
  const deadline = notificationDeadline(incident, events, now);
  const review = reviewDeadline(incident, now);
  const closed = incident.status === "cerrado";
  const scoped = incident.affectedData.trim() !== "" && incident.affectedPeople !== null;

  const notify: IncidentStep = notified
    ? { key: "notificar", label: INCIDENT_STEP_LABELS.notificar, state: "hecho", detail: "Hay notificaciones registradas." }
    : deadline.applies
      ? { key: "notificar", label: INCIDENT_STEP_LABELS.notificar, state: "pendiente", detail: "Falta avisar a la Autoridad dentro de las 48 h." }
      : { key: "notificar", label: INCIDENT_STEP_LABELS.notificar, state: "no_aplica", detail: "Gravedad baja y sin datos afectados." };

  const learn: IncidentStep = {
    key: "cerrar",
    label: INCIDENT_STEP_LABELS.cerrar,
    state: closed && (!review.applies || review.done) ? "hecho" : "pendiente",
    detail: !closed
      ? "Se cierra con causa y prevención."
      : review.applies && !review.done
        ? `Falta la revisión (${REVIEW_BUSINESS_DAYS} días hábiles).`
        : "Cerrado y revisado.",
  };

  return [
    {
      key: "contener",
      label: INCIDENT_STEP_LABELS.contener,
      state: incident.status === "abierto" ? "pendiente" : "hecho",
      detail: incident.status === "abierto" ? "Corte el daño antes de investigar." : "Marcado como contenido.",
    },
    {
      key: "preservar",
      label: INCIDENT_STEP_LABELS.preservar,
      state: hasAction ? "hecho" : "pendiente",
      detail: hasAction ? "Hay acciones anotadas con su hora." : "Exporte la auditoría y anote cada acción con su hora.",
    },
    {
      key: "evaluar",
      label: INCIDENT_STEP_LABELS.evaluar,
      state: scoped ? "hecho" : "pendiente",
      detail: scoped ? "Datos y personas indicados." : "Indique qué datos, cuántas personas y si eran sensibles.",
    },
    notify,
    {
      key: "recuperar",
      label: INCIDENT_STEP_LABELS.recuperar,
      state: closed ? "hecho" : "pendiente",
      detail: closed ? "Incidente cerrado." : "Vuelva a encender lo apagado con la causa corregida.",
    },
    learn,
  ];
}

/** Orden de la lista: abiertos, luego contenidos y al final cerrados; dentro de cada grupo, lo más reciente primero. */
export function compareIncidents(
  a: { status: IncidentStatus; detectedAt: string },
  b: { status: IncidentStatus; detectedAt: string },
): number {
  const rank: Record<IncidentStatus, number> = { abierto: 0, contenido: 1, cerrado: 2 };
  return rank[a.status] - rank[b.status] || b.detectedAt.localeCompare(a.detectedAt);
}
