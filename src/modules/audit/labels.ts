import { ROLE_LABELS, type AppRole } from "@/lib/auth/permissions";
import { APPLICATION_STATUS_LABELS, INTERVIEW_STATUS_LABELS, VACANCY_STATUS_LABELS } from "@/lib/labels";

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

export type AuditDescription = { text: string; href: string | null };

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

function describeText(entry: AuditEntry, metadata: Record<string, unknown>): string | null {
  const { action, entity_type: entity } = entry;

  if (action === "cv_descargado") return "Descargó un CV";
  if (action === "delete_requested") return "Pidió eliminar definitivamente a un usuario";
  if (action === "carga_masiva") return "Cargó una postulación en lote";
  if (action === "integracion_postulacion") return "Recibió una postulación por una integración";
  if (action === "formulario_postulacion") return "Recibió una postulación por el formulario en línea";
  if (action === "publicacion_portal_solicitada") {
    return typeof metadata.portal === "string" ? `Pidió publicar en ${metadata.portal}` : "Pidió publicar en un portal";
  }
  if (action === "publicacion_portal_retiro") return "Pidió retirar una oferta de un portal";
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
export function describeAuditEntry(entry: AuditEntry): AuditDescription {
  const metadata = asRecord(entry.metadata);
  return {
    // Sin frase conocida se muestra el nombre técnico: nada queda oculto.
    text: describeText(entry, metadata) ?? `${entry.action} · ${entry.entity_type}`,
    href: linkFor(entry, metadata),
  };
}
