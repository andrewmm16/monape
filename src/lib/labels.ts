import type { Enums } from "@/types/database";

/** Etiquetas en español para los valores controlados de la base de datos. */

export const VACANCY_STATUS_LABELS: Record<Enums<"vacancy_status">, string> = {
  borrador: "Borrador",
  publicada: "Publicada",
  cerrada: "Cerrada",
  archivada: "Archivada",
};

export const WORK_MODALITY_LABELS: Record<Enums<"work_modality">, string> = {
  presencial: "Presencial",
  remoto: "Remoto",
  hibrido: "Híbrido",
};

export const REQUIREMENT_CATEGORY_LABELS: Record<Enums<"requirement_category">, string> = {
  formacion: "Formación académica",
  experiencia: "Experiencia profesional",
  habilidad_tecnica: "Habilidad técnica",
  herramienta: "Herramienta o programa",
  certificacion: "Certificación",
  competencia: "Competencia",
  idioma: "Idioma",
  otro: "Otro",
};

export const REQUIREMENT_PRIORITY_LABELS: Record<Enums<"requirement_priority">, string> = {
  obligatorio: "Obligatorio",
  deseable: "Deseable",
};

export const CANDIDATE_SOURCE_LABELS: Record<Enums<"candidate_source">, string> = {
  manual: "Registro manual",
  bolsa_empleo: "Bolsa de empleo",
  linkedin: "LinkedIn",
  referido: "Referido",
  web_empresa: "Web de la empresa",
  otro: "Otra fuente",
};

export const DATA_ORIGIN_LABELS: Record<Enums<"data_origin">, string> = {
  declarado: "Declarado",
  extraido: "Extraído del CV",
  verificado: "Verificado por RRHH",
};

export const PROFILE_ITEM_KIND_LABELS: Record<Enums<"profile_item_kind">, string> = {
  experiencia: "Experiencia",
  formacion: "Formación",
  habilidad: "Habilidad",
  certificacion: "Certificación",
  idioma: "Idioma",
};

export const EXTRACTION_STATUS_LABELS: Record<Enums<"extraction_status">, string> = {
  completada: "Texto extraído",
  sin_texto: "Sin texto legible",
  fallida: "Extracción fallida",
};

export const APPLICATION_STATUS_LABELS: Record<Enums<"application_status">, string> = {
  nuevo: "Nuevo",
  en_revision: "En revisión",
  preseleccionado: "Preseleccionado",
  entrevista_programada: "Entrevista programada",
  en_evaluacion: "En evaluación",
  seleccionado: "Seleccionado",
  no_seleccionado: "No seleccionado",
  en_reserva: "En reserva",
  retirado: "Retirado",
};

export const APPLICATION_EVENT_LABELS: Record<Enums<"application_event_type">, string> = {
  postulacion_creada: "Postulación registrada",
  cambio_estado: "Cambio de estado",
  evaluacion_generada: "Evaluación de compatibilidad generada",
  evaluacion_revisada: "Evaluación revisada por RRHH",
  observacion: "Observación",
};

export const ASSESSMENT_LABELS: Record<Enums<"requirement_assessment">, string> = {
  acreditado: "Acreditado",
  no_cumplido: "Aparentemente no cumplido",
  sin_evidencia: "Sin evidencia suficiente",
  pendiente_verificacion: "Pendiente de verificación",
};

export const ASSESSMENT_DESCRIPTIONS: Record<Enums<"requirement_assessment">, string> = {
  acreditado: "El CV contiene evidencia explícita del requisito.",
  no_cumplido: "La información disponible indica que el requisito no se cumple. Debe confirmarse.",
  sin_evidencia: "El CV no menciona el requisito. No significa que la persona no lo cumpla.",
  pendiente_verificacion: "Requiere verificación humana (entrevista, documentos o referencias).",
};

export const COMPATIBILITY_LEVEL_LABELS: Record<Enums<"compatibility_level">, string> = {
  alta: "Compatibilidad alta",
  parcial: "Compatibilidad parcial",
  baja: "Compatibilidad baja",
  pendiente: "Evaluación pendiente",
};

export const EVALUATION_METHOD_LABELS: Record<Enums<"evaluation_method">, string> = {
  reglas: "Motor de reglas (determinista)",
  ia: "Asistente de IA",
};

export const REVIEW_OUTCOME_LABELS: Record<Enums<"evaluation_review_outcome">, string> = {
  conforme: "Conforme",
  con_observaciones: "Conforme con observaciones",
  requiere_reevaluacion: "Requiere nueva evaluación",
};

export const INTAKE_METHOD_LABELS: Record<Enums<"application_intake_method">, string> = {
  manual: "Registro manual",
  carga_masiva: "Carga masiva",
  formulario_en_linea: "Formulario en línea",
  integracion: "Integración",
};

/** Autor de eventos y evaluaciones sin usuario (integraciones). */
export const SYSTEM_ACTOR_LABEL = "Sistema (integración)";

export const DUPLICATE_REASON_LABELS: Record<string, string> = {
  correo: "mismo correo",
  telefono: "mismo teléfono",
  nombre: "mismo nombre",
  cv: "mismo CV",
};

export const EMPLOYMENT_TYPE_LABELS: Record<Enums<"employment_type">, string> = {
  tiempo_completo: "Tiempo completo",
  medio_tiempo: "Medio tiempo",
  temporal: "Temporal",
  practicas: "Prácticas",
  por_proyecto: "Por proyecto",
};

export const SALARY_PERIOD_LABELS: Record<Enums<"salary_period">, string> = {
  hora: "Por hora",
  dia: "Por día",
  semana: "Por semana",
  mes: "Por mes",
  anio: "Por año",
};

export const PRIVACY_NOTICE_STATUS_LABELS: Record<Enums<"privacy_notice_status">, string> = {
  borrador: "Borrador",
  vigente: "Vigente",
  retirado: "Retirado",
};

export const CONSENT_PURPOSE_LABELS: Record<Enums<"consent_purpose">, string> = {
  proceso_seleccion: "Proceso de selección",
  cartera_talento: "Cartera de talento",
};

export const CONSENT_METHOD_LABELS: Record<Enums<"consent_method">, string> = {
  formulario_en_linea: "Formulario en línea",
  registro_manual: "Registro manual",
  carga_masiva: "Carga masiva",
};
