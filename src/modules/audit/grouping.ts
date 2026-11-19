/**
 * Agrupa, solo para mostrar, las entradas SEGUIDAS del robot o del sistema sobre el mismo tipo de
 * registro (por ejemplo 30 evaluaciones con IA actualizadas una tras otra). Es pura: no consulta
 * nada ni cambia el orden; las personas nunca se agrupan.
 */

export type GroupableRow = {
  id: string | number;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  created_at: string;
};

export type AuditDisplayItem<T extends GroupableRow> =
  | { kind: "single"; row: T }
  | { kind: "group"; key: string; rows: T[]; entityType: string; actorName: string };

/** Mínimo de entradas seguidas para plegarlas en una sola fila. */
export const MIN_GROUP_SIZE = 2;

export function groupAuditRows<T extends GroupableRow>(rows: readonly T[]): AuditDisplayItem<T>[] {
  const items: AuditDisplayItem<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length >= MIN_GROUP_SIZE) {
      items.push({ kind: "group", key: `${run[0].id}+${run.length}`, rows: run, entityType: run[0].entity_type, actorName: run[0].actor_name });
    } else {
      for (const row of run) items.push({ kind: "single", row });
    }
    run = [];
  };
  for (const row of rows) {
    if (row.actor_id !== null) {
      flush();
      items.push({ kind: "single", row });
      continue;
    }
    const last = run[run.length - 1];
    if (last && (last.entity_type !== row.entity_type || last.actor_name !== row.actor_name)) flush();
    run.push(row);
  }
  flush();
  return items;
}

const PLURAL_NOUNS: Record<string, string> = {
  ai_evaluation_jobs: "evaluaciones con IA",
  candidate_evaluations: "evaluaciones de compatibilidad",
  resume_extractions: "lecturas de CV",
  learned_equivalences: "sinónimos aprendidos",
  caleta_prospects: "prospectos de Caleta",
  portal_publications: "publicaciones en portales",
  applications: "postulaciones",
  candidates: "candidatos",
  candidate_profile_items: "datos de perfil de candidatos",
  resumes: "CV",
  requirement_verifications: "verificaciones de requisitos",
  vacancies: "vacantes",
  vacancy_requirements: "requisitos de vacante",
  interviews: "entrevistas",
  profiles: "usuarios",
  consent_records: "constancias de consentimiento",
  talent_invitations: "invitaciones de la base de talentos",
  candidate_tags: "etiquetas de candidatos",
  application_killer_answers: "respuestas a preguntas eliminatorias",
  vacancy_killer_questions: "preguntas eliminatorias",
  candidate_portal_settings: "ajustes del portal del candidato",
  email_settings: "ajustes de correo",
  talent_pool: "registros de la base de talentos",
  talent_tags: "etiquetas de la base de talentos",
};

const PAST_VERBS: Record<string, string> = { insert: "creó", update: "actualizó", delete: "eliminó" };

/** «El sistema actualizó 30 evaluaciones con IA». Con acciones distintas: «registró cambios en…». */
export function describeAuditGroup(group: { rows: readonly GroupableRow[]; entityType: string; actorName: string }): string {
  const who = /^robot/i.test(group.actorName) && /portal/i.test(group.actorName) ? "El robot de portales" : "El sistema";
  const actions = new Set(group.rows.map((row) => row.action));
  const only = actions.size === 1 ? [...actions][0] : null;
  const verb = (only && PAST_VERBS[only]) || "registró cambios en";
  const noun = PLURAL_NOUNS[group.entityType] ?? "registros del mismo tipo";
  return `${who} ${verb} ${group.rows.length} ${noun}`;
}

const TIME_ZONE = "America/Lima";
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const timeFormatter = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE });

/**
 * «entre 10:12 y 10:15» (mismo día) o «a las 10:12» (misma hora y minuto). Si abarca varios días
 * devuelve `null` y quien lo muestra pone las fechas completas.
 */
export function groupTimeRange(rows: readonly { created_at: string }[]): string | null {
  const times = rows.map((row) => new Date(row.created_at).getTime()).filter((time) => !Number.isNaN(time));
  if (times.length === 0) return null;
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  if (dayFormatter.format(first) !== dayFormatter.format(last)) return null;
  const start = timeFormatter.format(first);
  const end = timeFormatter.format(last);
  return start === end ? `a las ${start}` : `entre ${start} y ${end}`;
}
