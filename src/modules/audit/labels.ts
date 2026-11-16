import { ROLE_LABELS, type AppRole } from "@/lib/auth/permissions";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  APPLICATION_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  INTERVIEW_MODALITY_LABELS,
  INTERVIEW_RESULT_LABELS,
  INTERVIEW_STATUS_LABELS,
  SALARY_PERIOD_LABELS,
  WORK_MODALITY_LABELS,
  PORTAL_ERROR_LABELS,
  REQUIREMENT_CATEGORY_LABELS,
  REQUIREMENT_PRIORITY_LABELS,
  VACANCY_STATUS_LABELS,
} from "@/lib/labels";

/** Grupos del filtro «Tipo»: cada uno reúne las tablas que audita la base de datos. */
export const AUDIT_GROUPS = {
  vacantes: { label: "Vacantes", entities: ["vacancies", "vacancy_requirements", "vacancy_members"] },
  postulaciones: {
    label: "Postulaciones y evaluaciones",
    entities: ["applications", "candidate_evaluations", "requirement_verifications"],
  },
  candidatos: { label: "Candidatos", entities: ["candidates", "candidate_profile_items"] },
  cv: { label: "CV", entities: ["resumes", "resume_extractions"] },
  entrevistas: { label: "Entrevistas", entities: ["interviews"] },
  usuarios: { label: "Usuarios", entities: ["profiles"] },
  privacidad: { label: "Privacidad y consentimientos", entities: ["privacy_notices", "consent_records"] },
  portales: { label: "Portales y robot", entities: ["portal_publications"] },
} as const;

export type AuditGroup = keyof typeof AUDIT_GROUPS;
export const AUDIT_GROUP_KEYS = Object.keys(AUDIT_GROUPS) as [AuditGroup, ...AuditGroup[]];

const ENTITY_NOUNS: Record<string, string> = {
  vacancies: "una vacante",
  vacancy_requirements: "un requisito de vacante",
  vacancy_members: "un integrante de vacante",
  candidates: "un candidato",
  candidate_profile_items: "un dato del perfil de un candidato",
  resumes: "un CV",
  resume_extractions: "la lectura de un CV",
  applications: "una postulación",
  candidate_evaluations: "una evaluación de compatibilidad",
  requirement_verifications: "una verificación de requisito",
  interviews: "una entrevista",
  profiles: "un usuario",
  privacy_notices: "un aviso de privacidad",
  consent_records: "una constancia de consentimiento",
  portal_publications: "una publicación en un portal",
};

const ROW_VERBS: Record<string, string> = { insert: "Creó", update: "Modificó", delete: "Eliminó" };

/** Etiquetas de estado según la entidad cuyo campo `status` cambió. */
const STATUS_LABELS: Record<string, Record<string, string>> = {
  applications: APPLICATION_STATUS_LABELS,
  vacancies: VACANCY_STATUS_LABELS,
  interviews: INTERVIEW_STATUS_LABELS,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuditEntry = {
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: unknown;
};

export type AuditDescription = { text: string; href: string | null; details: string[] };

/** Enlaces entre un registro y lo que toca (postulación → candidato y vacante, etc.). */
export type AuditLinks = {
  vacancyId?: string | null;
  portalId?: string | null;
  candidateId?: string | null;
  applicationId?: string | null;
  requirementId?: string | null;
};

/** Nombres reales leídos al mostrar la auditoría (no se guardan en el log). */
export type AuditContext = {
  vacancies: Record<string, { title: string; code: string | null }>;
  portals: Record<string, string>;
  candidates: Record<string, string>;
  profiles: Record<string, { name: string; email: string; role: string }>;
  requirements: Record<string, { text: string; category: string; priority: string; vacancyId: string }>;
  links: Record<string, AuditLinks>;
};

const FIELD_LABELS: Record<string, string> = {
  title: "título", description: "descripción", responsibilities: "funciones", department: "área", location: "ubicación",
  modality: "modalidad", contract_type: "tipo de contrato", opening_date: "fecha de apertura", closing_date: "fecha de cierre",
  owner_id: "responsable", status: "estado", city: "ciudad", region: "región", employment_type: "jornada",
  salary_min: "sueldo mínimo", salary_max: "sueldo máximo", salary_currency: "moneda del sueldo", salary_period: "periodo del sueldo",
  is_confidential: "confidencialidad", public_code: "código público", first_published_at: "fecha de primera publicación",
  criteria_version: "versión de criterios", criteria_approved_at: "fecha de aprobación de criterios",
  criteria_approved_by: "quién aprobó los criterios", category: "categoría", priority: "prioridad", keywords: "palabras clave",
  weight: "peso", min_years: "años mínimos", is_essential: "es excluyente", position: "orden", full_name: "nombre",
  email: "correo", phone: "teléfono", linkedin_url: "enlace de LinkedIn", role: "rol", is_active: "activo",
  deactivated_at: "fecha de desactivación", deleted_at: "fecha de eliminación", scheduled_at: "fecha y hora",
  duration_minutes: "duración", interviewers: "entrevistadores", instructions: "indicaciones", result: "resultado",
  result_notes: "notas del resultado", cancel_reason: "motivo de cancelación", assigned_evaluator_id: "evaluador asignado",
  opinion_requested_at: "pedido de opinión", opinion_answered_at: "respuesta de opinión", review_status: "estado de revisión",
  review_outcome: "resultado de revisión", review_notes: "notas de revisión", is_current: "versión vigente", body: "texto",
  effective_from: "vigente desde", approval_reference: "referencia de aprobación", granted: "consentimiento otorgado",
  revoked_at: "fecha de revocación", note: "nota", error_code: "código de error", external_id: "código en el portal",
  external_url: "enlace en el portal",
};

/** Ids que hay que resolver a nombres, agrupados por tabla. */
export function collectIds(entries: readonly AuditEntry[]) {
  const sets: Record<string, Set<string>> = {};
  const add = (table: string, value: unknown) => {
    const id = uuidOf(value);
    if (id) (sets[table] ??= new Set()).add(id);
  };
  for (const entry of entries) {
    const meta = asRecord(entry.metadata);
    add(entry.entity_type, entry.entity_id);
    add("vacancies", meta.vacancy_id);
    add("portals", meta.portal_id);
    add("candidates", meta.candidate_id);
    add("applications", meta.application_id);
    add("portal_publications", meta.publication_id);
  }
  const names = [
    "vacancies", "portals", "candidates", "applications", "portal_publications", "vacancy_requirements", "profiles",
    "interviews", "resumes", "candidate_evaluations", "requirement_verifications", "consent_records", "candidate_profile_items",
  ] as const;
  return Object.fromEntries(names.map((name) => [name, [...(sets[name] ?? [])]])) as Record<(typeof names)[number], string[]>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function uuidOf(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function change(metadata: Record<string, unknown>, key: string): { from: unknown; to: unknown } | null {
  const value = asRecord(metadata[key]);
  return "from" in value && "to" in value ? { from: value.from, to: value.to } : null;
}

function labelOf(labels: Record<string, string> | undefined, value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "—");
  return labels?.[text] ?? text;
}

function linkFor(entry: AuditEntry, metadata: Record<string, unknown>): string | null {
  const id = uuidOf(entry.entity_id);
  if (entry.action !== "delete") {
    if (entry.entity_type === "vacancies" && id) return `/vacantes/${id}`;
    if (entry.entity_type === "applications" && id) return `/postulaciones/${id}`;
    if (entry.entity_type === "candidates" && id) return `/candidatos/${id}`;
  }
  const vacancyId = uuidOf(metadata.vacancy_id);
  if (entry.entity_type === "portal_publications" && vacancyId) return `/vacantes/${vacancyId}`;
  const candidateId = uuidOf(metadata.candidate_id);
  if (entry.entity_type === "resumes" && candidateId) return `/candidatos/${candidateId}`;
  return null;
}

type Resolved = {
  vacancy: string | null;
  vacancyCode: string | null;
  portal: string | null;
  candidate: string | null;
  requirement: { text: string; category: string; priority: string } | null;
  user: { name: string; email: string; role: string } | null;
};

/** Cruza el registro con los nombres leídos: sigue los enlaces hasta dar con vacante, portal, candidato, etc. */
function resolve(entry: AuditEntry, metadata: Record<string, unknown>, ctx: AuditContext | undefined): Resolved {
  const empty: Resolved = { vacancy: null, vacancyCode: null, portal: null, candidate: null, requirement: null, user: null };
  if (!ctx) return empty;
  const own = ctx.links[`${entry.entity_type}:${entry.entity_id}`] ?? {};
  const applicationId = own.applicationId ?? uuidOf(metadata.application_id) ?? (entry.entity_type === "applications" ? entry.entity_id : null);
  const application = (applicationId ? ctx.links[`applications:${applicationId}`] : undefined) ?? {};
  const requirementId = own.requirementId ?? (entry.entity_type === "vacancy_requirements" ? entry.entity_id : null);
  const requirement = requirementId ? ctx.requirements[requirementId] : undefined;
  const vacancyId =
    uuidOf(metadata.vacancy_id) ??
    own.vacancyId ??
    application.vacancyId ??
    requirement?.vacancyId ??
    (entry.entity_type === "vacancies" ? uuidOf(entry.entity_id) : null);
  const candidateId =
    uuidOf(metadata.candidate_id) ??
    own.candidateId ??
    application.candidateId ??
    (entry.entity_type === "candidates" ? uuidOf(entry.entity_id) : null);
  const portalId = uuidOf(metadata.portal_id) ?? own.portalId ?? null;
  const vacancy = vacancyId ? ctx.vacancies[vacancyId] : undefined;
  return {
    vacancy: vacancy?.title ?? null,
    vacancyCode: vacancy?.code ?? null,
    portal: (typeof metadata.portal === "string" ? metadata.portal : null) ?? (portalId ? (ctx.portals[portalId] ?? null) : null),
    candidate: candidateId ? (ctx.candidates[candidateId] ?? null) : null,
    requirement: requirement ?? null,
    user: entry.entity_type === "profiles" && entry.entity_id ? (ctx.profiles[entry.entity_id] ?? null) : null,
  };
}

const quoted = (title: string) => `«${title}»`;

/** Frases más precisas cuando se conoce el nombre de lo afectado; `null` si vale la frase básica. */
function describeNamed(entry: AuditEntry, metadata: Record<string, unknown>, r: Resolved): string | null {
  const { action, entity_type: entity } = entry;
  const v = r.vacancy ? quoted(r.vacancy) : null;
  const portal = r.portal;
  const roles = ROLE_LABELS as Record<AppRole, string>;
  if (action === "publicacion_portal_solicitada" && v && portal) return `Pidió publicar la vacante ${v} en ${portal}`;
  if (action === "publicacion_portal_retiro" && v) return `Pidió retirar la vacante ${v} de ${portal ?? "un portal"}`;
  if (action === "publicacion_portal_manual" && v && portal) return `Registró a mano la publicación de la vacante ${v} en ${portal}`;
  if (action === "publicacion_portal_retiro_manual" && v) return `Marcó como retirada a mano la oferta de ${v}${portal ? ` en ${portal}` : ""}`;
  if (action === "publicacion_portal_publicada" && v) return `El robot publicó la vacante ${v} en ${portal ?? "un portal"}`;
  if (action === "publicacion_portal_retirada" && v) return `El robot retiró la vacante ${v} de ${portal ?? "un portal"}`;
  if (action === "publicacion_portal_error" && v) return `El robot falló al trabajar la vacante ${v}${portal ? ` en ${portal}` : ""}`;
  if (action === "reporte_exportado" && v) return `Exportó a CSV el reporte de postulaciones de ${v}`;
  const to = v ? ` a ${v}` : "";
  if (r.candidate) {
    if (action === "cv_descargado") return `Descargó el CV de ${r.candidate}`;
    if (action === "carga_masiva") return `Cargó en lote la postulación de ${r.candidate}${to}`;
    if (action === "integracion_postulacion") return `Recibió por una integración la postulación de ${r.candidate}${to}`;
    if (action === "formulario_postulacion") return `Recibió por el formulario en línea la postulación de ${r.candidate}${to}`;
  }

  if (entity === "profiles" && r.user) {
    const name = r.user.name || r.user.email;
    if (action === "insert") return `Se creó la cuenta de ${name} (invitación enviada a ${r.user.email})`;
    if (action === "update") {
      const role = change(metadata, "role");
      if (role) return `Cambió el rol de ${name}: ${labelOf(roles, role.from)} → ${labelOf(roles, role.to)}`;
      const active = change(metadata, "is_active");
      if (active) return active.to === true ? `Activó la cuenta de ${name}` : `Desactivó la cuenta de ${name}`;
      return `Modificó los datos de ${name}`;
    }
  }
  if (entity === "vacancies" && v) {
    if (action === "insert") return `Creó la vacante ${v}`;
    if (action === "update") {
      const status = change(metadata, "status");
      if (status) return `Cambió el estado de la vacante ${v}: ${labelOf(VACANCY_STATUS_LABELS, status.from)} → ${labelOf(VACANCY_STATUS_LABELS, status.to)}`;
      const version = change(metadata, "criteria_version");
      if (version) return `Aprobó los criterios de selección de la vacante ${v} (versión ${String(version.to)})`;
    }
  }
  if (entity === "vacancy_requirements" && v) {
    const verb = ROW_VERBS[action];
    if (verb) return `${verb} un requisito de la vacante ${v}`;
  }
  if (entity === "applications" && r.candidate) {
    if (action === "insert") return `Registró la postulación de ${r.candidate}${to}`;
    const status = change(metadata, "status");
    if (action === "update" && status) {
      return `Cambió el estado de la postulación de ${r.candidate}: ${labelOf(APPLICATION_STATUS_LABELS, status.from)} → ${labelOf(APPLICATION_STATUS_LABELS, status.to)}`;
    }
  }
  return null;
}

const VALUE_LABELS: Record<string, Record<string, string>> = {
  "vacancies.status": VACANCY_STATUS_LABELS,
  "vacancies.modality": WORK_MODALITY_LABELS,
  "vacancies.employment_type": EMPLOYMENT_TYPE_LABELS,
  "vacancies.salary_period": SALARY_PERIOD_LABELS,
  "applications.status": APPLICATION_STATUS_LABELS,
  "interviews.status": INTERVIEW_STATUS_LABELS,
  "interviews.modality": INTERVIEW_MODALITY_LABELS,
  "interviews.result": INTERVIEW_RESULT_LABELS,
  "vacancy_requirements.category": REQUIREMENT_CATEGORY_LABELS,
  "vacancy_requirements.priority": REQUIREMENT_PRIORITY_LABELS,
  "profiles.role": ROLE_LABELS,
};

/** Valor guardado en el registro, escrito para una persona (Sí/No, fechas y etiquetas en español). */
function formatValue(entity: string, field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "vacío";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") {
    const label = VALUE_LABELS[`${entity}.${field}`]?.[value];
    if (label) return label;
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(value) && !Number.isNaN(Date.parse(value))) {
      return value.length > 10 ? formatDateTime(value) : formatDate(value);
    }
    return value;
  }
  return String(value);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Líneas bajo la frase: vacante, portal, candidato, usuario, requisito, campos cambiados y motivo de error. */
function describeDetails(entry: AuditEntry, metadata: Record<string, unknown>, r: Resolved): string[] {
  const lines: string[] = [];
  if (r.vacancy) lines.push(`Vacante: ${quoted(r.vacancy)}${r.vacancyCode ? ` (código ${r.vacancyCode})` : ""}`);
  if (r.portal) lines.push(`Portal: ${r.portal}`);
  if (r.candidate) lines.push(`Candidato: ${r.candidate}`);
  if (r.user) {
    lines.push(`Usuario: ${r.user.name || "(sin nombre)"} · ${r.user.email} · ${labelOf(ROLE_LABELS as Record<AppRole, string>, r.user.role)}`);
  }
  if (r.requirement) {
    const category = labelOf(REQUIREMENT_CATEGORY_LABELS, r.requirement.category);
    const priority = labelOf(REQUIREMENT_PRIORITY_LABELS, r.requirement.priority);
    lines.push(`Requisito: ${quoted(r.requirement.text)} · ${category} · ${priority}`);
  }
  const entity = entry.entity_type;
  const changes = asRecord(metadata.changes);
  const changeKeys = Object.keys(changes);
  const fields = Array.isArray(metadata.changed_fields) ? metadata.changed_fields.filter((f): f is string => typeof f === "string") : [];
  for (const key of changeKeys.slice(0, 8)) {
    const { from, to } = asRecord(changes[key]);
    lines.push(`${capitalize(FIELD_LABELS[key] ?? key)}: ${formatValue(entity, key, from)} → ${formatValue(entity, key, to)}`);
  }
  // Campos sin valor guardado (por ejemplo datos personales): solo se indica que cambiaron.
  const unlisted = fields.filter((f) => !changeKeys.includes(f) && f !== "status" && f !== "role" && f !== "is_active");
  if (unlisted.length > 0 && changeKeys.length === 0) lines.push(`Campos modificados: ${unlisted.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`);
  else if (unlisted.length > 0) lines.push(`También cambió: ${unlisted.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`);
  const values = asRecord(metadata.values);
  if (entry.action !== "update" && Object.keys(values).length > 0) {
    const shown = Object.entries(values)
      .slice(0, 8)
      .map(([key, value]) => `${FIELD_LABELS[key] ?? key}: ${formatValue(entity, key, value)}`);
    lines.push(`Datos: ${shown.join(" · ")}`);
  }
  if (typeof metadata.error_code === "string" && metadata.error_code) {
    lines.push(`Motivo del error: ${PORTAL_ERROR_LABELS[metadata.error_code] ?? metadata.error_code}`);
  }
  if (entry.entity_id) lines.push(`Registro: ${entry.entity_type} · ${entry.entity_id.slice(0, 8)}`);
  return lines;
}

function describeText(entry: AuditEntry, metadata: Record<string, unknown>): string | null {
  const { action, entity_type: entity } = entry;

  if (action === "cv_descargado") return "Descargó un CV";
  if (action === "reporte_exportado") return "Exportó un reporte de postulaciones a CSV";
  if (action === "delete_requested") return "Pidió eliminar definitivamente a un usuario";
  if (action === "carga_masiva") return "Cargó una postulación en lote";
  if (action === "integracion_postulacion") return "Recibió una postulación por una integración";
  if (action === "formulario_postulacion") return "Recibió una postulación por el formulario en línea";
  if (action === "publicacion_portal_solicitada") {
    return typeof metadata.portal === "string" ? `Pidió publicar en ${metadata.portal}` : "Pidió publicar en un portal";
  }
  if (action === "publicacion_portal_retiro") return "Pidió retirar una oferta de un portal";
  if (action === "publicacion_portal_manual") {
    return typeof metadata.portal === "string" ? `Registró una publicación a mano en ${metadata.portal}` : "Registró una publicación a mano en un portal";
  }
  if (action === "publicacion_portal_retiro_manual") return "Marcó como retirada una oferta publicada a mano";
  if (action === "publicacion_portal_publicada") return "El robot publicó una oferta en un portal";
  if (action === "publicacion_portal_retirada") return "El robot retiró una oferta de un portal";
  if (action === "publicacion_portal_error") return "El robot informó un error al trabajar en un portal";

  const noun = ENTITY_NOUNS[entity];
  const verb = ROW_VERBS[action];
  if (!noun || !verb) return null;

  if (action === "update") {
    const status = change(metadata, "status");
    if (status) {
      return `Cambió el estado de ${noun}: ${labelOf(STATUS_LABELS[entity], status.from)} → ${labelOf(STATUS_LABELS[entity], status.to)}`;
    }
    const role = change(metadata, "role");
    if (entity === "profiles" && role) {
      return `Cambió el rol de ${noun}: ${labelOf(ROLE_LABELS as Record<AppRole, string>, role.from)} → ${labelOf(ROLE_LABELS as Record<AppRole, string>, role.to)}`;
    }
    const active = change(metadata, "is_active");
    if (entity === "profiles" && active) return active.to === true ? "Reactivó a un usuario" : "Desactivó a un usuario";
    const fields = Array.isArray(metadata.changed_fields) ? metadata.changed_fields.filter((f) => typeof f === "string") : [];
    if (fields.length > 0) return `${verb} ${noun} (campos: ${fields.join(", ")})`;
  }
  return `${verb} ${noun}`;
}

/** Frase en español de un registro de auditoría y, si existe, el enlace a lo afectado. */
export function describeAuditEntry(entry: AuditEntry, ctx?: AuditContext): AuditDescription {
  const metadata = asRecord(entry.metadata);
  const resolved = resolve(entry, metadata, ctx);
  return {
    // Sin frase conocida se muestra el nombre técnico: nada queda oculto.
    text: (ctx ? describeNamed(entry, metadata, resolved) : null) ?? describeText(entry, metadata) ?? `${entry.action} · ${entry.entity_type}`,
    href: linkFor(entry, metadata),
    details: ctx ? describeDetails(entry, metadata, resolved) : [],
  };
}
