/**
 * Plantillas de correo editables por RRHH. Este módulo (sin dependencias de
 * servidor) define las claves, los metadatos para la interfaz y el texto por
 * defecto. El texto por defecto reproduce exactamente los correos del código:
 * si una clave no tiene versión editada en la base de datos, se usa este texto.
 */

export const EMAIL_TEMPLATE_KEYS = ["entrevista_programada", "seleccionado", "no_seleccionado"] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export type EmailTemplateContent = { subject: string; body: string };

export function isEmailTemplateKey(value: string): value is EmailTemplateKey {
  return (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(value);
}

export type TemplateVars = { nombre: string; vacante: string; empresa: string };

/** Sustituye {{nombre}}, {{vacante}} y {{empresa}} por sus valores. */
export function substituteVariables(text: string, vars: TemplateVars): string {
  return text
    .replaceAll("{{nombre}}", vars.nombre)
    .replaceAll("{{vacante}}", vars.vacante)
    .replaceAll("{{empresa}}", vars.empresa);
}

/** Valores de ejemplo para la vista previa del editor. */
export const EXAMPLE_TEMPLATE_VARS: TemplateVars = {
  nombre: "Ana Pérez",
  vacante: "la vacante «Asistente de RRHH»",
  empresa: "la empresa",
};

/** Variables que RRHH puede usar en el asunto y el cuerpo. */
export const EMAIL_TEMPLATE_VARIABLES = [
  { token: "{{nombre}}", help: "Nombre del candidato" },
  { token: "{{vacante}}", help: "La vacante (p. ej. «la vacante “Contador”»)" },
  { token: "{{empresa}}", help: "Nombre de la empresa" },
] as const;

/** Nombre y momento de envío de cada plantilla, para la interfaz. */
export const EMAIL_TEMPLATE_META: Record<EmailTemplateKey, { label: string; when: string }> = {
  entrevista_programada: {
    label: "Entrevista programada",
    when: "Se puede enviar al pasar a «Entrevista programada» (casilla «Avisar al candidato»).",
  },
  seleccionado: {
    label: "Seleccionado",
    when: "Se puede enviar al pasar a «Seleccionado» (casilla «Avisar al candidato»).",
  },
  no_seleccionado: {
    label: "No seleccionado",
    when: "Se puede enviar al pasar a «No seleccionado» (casilla «Avisar al candidato»).",
  },
};

export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailTemplateKey, EmailTemplateContent> = {
  entrevista_programada: {
    subject: "Te invitamos a una entrevista",
    body: [
      "Te escribimos de parte de {{empresa}} para contarte que tu postulación a {{vacante}} avanzó a la etapa de entrevista.",
      "Nuestro equipo de Recursos Humanos coordinará contigo los detalles. Revisa también tu carpeta de correo no deseado.",
    ].join("\n\n"),
  },
  seleccionado: {
    subject: "Novedades sobre tu postulación",
    body: [
      "Nos alegra comunicarte que fuiste seleccionado/a en el proceso de {{vacante}} de {{empresa}}.",
      "Una persona del área de Recursos Humanos se pondrá en contacto contigo por este medio para coordinar los siguientes pasos.",
      "Gracias por tu interés y por el tiempo dedicado al proceso.",
    ].join("\n\n"),
  },
  no_seleccionado: {
    subject: "Novedades sobre tu postulación",
    body: [
      "Gracias por tu interés en {{vacante}} y por el tiempo dedicado a participar en el proceso de {{empresa}}.",
      "Tras revisar las postulaciones, hemos decidido continuar con otros perfiles y tu candidatura no seguirá en este proceso.",
      "Valoramos que nos hayas considerado y te deseamos éxito en tu búsqueda profesional.",
    ].join("\n\n"),
  },
};
