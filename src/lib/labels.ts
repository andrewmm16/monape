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

export const KILLER_QUESTION_TYPE_LABELS: Record<Enums<"killer_question_type">, string> = {
  si_no: "Sí / No",
  numero: "Número",
  opcion_unica: "Opción única",
};

export const KILLER_COMPARATOR_LABELS: Record<Enums<"killer_number_comparator">, string> = {
  mayor_igual: "Mayor o igual que",
  menor_igual: "Menor o igual que",
  igual: "Igual a",
};

export const CANDIDATE_SOURCE_LABELS: Record<Enums<"candidate_source">, string> = {
  manual: "Registro manual",
  bolsa_empleo: "Bolsa de empleo",
  linkedin: "LinkedIn",
  referido: "Referido",
  web_empresa: "Web de la empresa",
  otro: "Otra fuente",
};

export const CALETA_SOURCE_LABELS: Record<Enums<"caleta_source">, string> = {
  linkedin: "LinkedIn",
  cip: "CIP (Colegio de Ingenieros)",
  grupo: "Grupo de empleo",
  google: "Búsqueda en Google",
  referido: "Referido",
  otro: "Otra fuente",
};

export const CALETA_STATUS_LABELS: Record<Enums<"caleta_status">, string> = {
  encontrado: "Encontrado",
  contactado: "Contactado",
  conectado: "Conectado (aceptó en LinkedIn)",
  respondio: "Respondió",
  interesado: "Interesado",
  descartado: "Descartado",
  derivado: "Derivado a candidato",
};

export const CALETA_CONTACT_CHANNEL_LABELS: Record<Enums<"caleta_contact_channel">, string> = {
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  email: "Correo",
  otro: "Otro",
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
  preseleccionado: "Por entrevistar",
  entrevista_programada: "Entrevista programada",
  en_evaluacion: "Evaluación post-entrevista",
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
  requisito_verificado: "Requisitos verificados por RRHH",
  entrevista_programada: "Entrevista programada",
  entrevista_reprogramada: "Entrevista reprogramada",
  entrevista_cancelada: "Entrevista cancelada",
  entrevista_resultado: "Resultado de la entrevista",
  correo_enviado: "Correo enviado al candidato",
};

export const INTERVIEW_MODALITY_LABELS: Record<Enums<"interview_modality">, string> = {
  presencial: "Presencial",
  virtual: "Virtual",
  telefonica: "Telefónica",
};

export const INTERVIEW_STATUS_LABELS: Record<Enums<"interview_status">, string> = {
  programada: "Programada",
  realizada: "Realizada",
  no_asistio: "No asistió",
  cancelada: "Cancelada",
};

export const INTERVIEW_RESULT_LABELS: Record<Enums<"interview_result">, string> = {
  paso: "Pasó",
  no_paso: "No pasó",
};

export const VERIFICATION_SOURCE_LABELS: Record<Enums<"verification_source">, string> = {
  entrevista: "Entrevista",
  documento: "Documento",
  referencia: "Referencia",
  prueba_tecnica: "Prueba técnica",
  otro: "Otro",
};

/** Cómo se dice la fuente en una frase: «verificado en {frase}». */
export const VERIFICATION_SOURCE_PHRASES: Record<Enums<"verification_source">, string> = {
  entrevista: "entrevista",
  documento: "documento",
  referencia: "referencia",
  prueba_tecnica: "prueba técnica",
  otro: "otro medio",
};

export const ASSESSMENT_LABELS: Record<Enums<"requirement_assessment">, string> = {
  acreditado: "Aparece en el CV",
  no_cumplido: "Probablemente no cumple",
  sin_evidencia: "No aparece en el CV",
  pendiente_verificacion: "Por confirmar",
};

export const ASSESSMENT_DESCRIPTIONS: Record<Enums<"requirement_assessment">, string> = {
  acreditado: "El CV contiene evidencia explícita del requisito.",
  no_cumplido: "La información disponible indica que el requisito no se cumple. Debe confirmarse.",
  sin_evidencia: "El CV no menciona el requisito. No significa que la persona no lo cumpla.",
  pendiente_verificacion: "Requiere verificación humana (entrevista, documentos o referencias).",
};

/**
 * El nivel mide cumplimiento frente al puesto, no posición frente a los demás
 * candidatos: se calcula con el CV de una sola persona, la base de datos lo
 * recalcula al registrar la evaluación y queda congelado en el expediente. Las
 * etiquetas tienen que decir eso y nada más. «Afinidad alta/media/baja»
 * prometía una comparación entre candidatos que el número no contiene, y con
 * 40 postulantes que cumplieran, los 40 salían en «afinidad alta».
 *
 * La comparación entre candidatos vive aparte, en la posición dentro de la
 * vacante (`rankVacancyApplications`), que sí mira a todo el grupo.
 */
export const COMPATIBILITY_LEVEL_LABELS: Record<Enums<"compatibility_level">, string> = {
  alta: "Cumple los requisitos",
  parcial: "Cumple en parte",
  baja: "Cumple pocos requisitos",
  // «Faltan datos en el CV» decía algo falso en el caso más frecuente: este
  // nivel cubre tanto el CV ilegible como el CV completo de alguien de otro
  // rubro, donde no falta ningún dato y simplemente no hay coincidencias. En el
  // banco de 32 CV, los 16 candidatos «medio» y «no cumple» caen aquí.
  pendiente: "El CV no evidencia los requisitos",
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
  cartera: "Base de talentos",
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

export const PORTAL_PUBLICATION_STATUS_LABELS: Record<Enums<"portal_publication_status">, string> = {
  pendiente: "En cola",
  publicando: "Publicando…",
  publicada: "Publicada",
  retirar: "Retirando…",
  retirada: "Retirada",
  error: "Con error",
};

/** Códigos de fallo que informa el robot; uno desconocido se muestra como genérico. */
export const PORTAL_ERROR_LABELS: Record<string, string> = {
  sesion_expirada: "La sesión del robot en el portal venció; hay que iniciarla de nuevo.",
  verificacion_requerida: "El portal pidió una verificación (un código) que solo puede hacer una persona.",
  pagina_cambio: "El portal cambió su página y el robot no pudo continuar.",
  navegador_cerrado: "El navegador del robot se cerró. No es un cambio del portal: hay que reiniciar el robot.",
  publicacion_rechazada: "El portal no aceptó la oferta.",
  demasiados_intentos: "El robot agotó los intentos. Revise el portal y vuelva a solicitarla.",
  retiro_fallido: "El robot no pudo retirar la oferta tras varios intentos y sigue publicada en el portal. Desmarque el portal para pedir el retiro de nuevo, o retírela a mano.",
  fallos_seguidos: "El robot falló varias veces seguidas y se detuvo; revise el portal.",
  portal_no_disponible: "El portal no respondió (caído o sin conexión). No es un cambio de su página; el robot lo reintenta.",
  oferta_no_encontrada: "La oferta ya no existe en el portal (vencida, borrada o retirada a mano). El robot dejó de revisarla.",
  sincronizacion_pendiente: "Antes de retirar la oferta el robot no logró traer todos los postulantes; reintenta para no perderlos.",
  api_no_disponible: "El robot no pudo comunicarse con la aplicación para informar un resultado.",
};
