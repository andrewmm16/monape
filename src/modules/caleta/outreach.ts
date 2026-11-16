import type { Enums } from "@/types/database";

/**
 * Mensajes y ritmo del primer contacto del Reclutador Caleta. Puro (sin servidor)
 * para poder usarlo en el panel y probarlo.
 */

/** Quien firma el mensaje. */
export const RECRUITER_NAME = "Pedro Córdova";
// Empresa y canal de RRHH para que la persona interesada responda (contacto
// propio del cliente, no un dato de terceros).
export const COMPANY_NAME = "Grupo Eco Plaza";
export const RRHH_CONTACT = "987 381 630 (Sra. Jessica Hinojosa)";

/**
 * Invitaciones de LinkedIn recomendadas por semana con una cuenta gratuita
 * (dato de terceros, no oficial: ~100 por semana). Pasarse arriesga que LinkedIn
 * restrinja la cuenta, que es el canal principal.
 */
export const LINKEDIN_WEEKLY_SAFE_LIMIT = 100;

/** Inicio de la ventana móvil de 7 días con la que se cuentan las invitaciones. */
export function linkedinWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

/**
 * Primer mensaje. Es honesto: dice quién escribe, para qué empresa y de dónde
 * salió el contacto, y ofrece no volver a escribir (un solo primer contacto).
 * - linkedin: se envía por mensaje directo cuando la persona acepta la invitación.
 * - whatsapp / email: el dato ya lo publicó la persona; no se le vuelve a pedir.
 */
export function buildOutreachMessage(
  fullName: string,
  vacancyTitle: string,
  channel: Enums<"caleta_contact_channel">,
): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  const saludo = first ? `Buenas tardes, ${first}.` : "Buenas tardes, ingeniero(a).";
  const intro = `${saludo} Soy ${RECRUITER_NAME} y apoyo a ${COMPANY_NAME} con una vacante de ${vacancyTitle} en Lima.`;
  const cierre = "Si no es el momento, me avisa y no le vuelvo a escribir. Gracias.";
  if (channel === "linkedin") {
    return `${intro} Vi su perfil en LinkedIn y encaja muy bien con el puesto. ¿Le interesaría conocer los detalles? Puede responderme por aquí o coordinar con Recursos Humanos al ${RRHH_CONTACT}. ${cierre}`;
  }
  return `${intro} Vi su perfil en LinkedIn, donde publicó este contacto, y encaja muy bien con el puesto. ¿Le interesaría conocer los detalles? Puede responderme por aquí o coordinar con Recursos Humanos al ${RRHH_CONTACT}. ${cierre}`;
}

/** Enlace de WhatsApp con el mensaje ya escrito (lo envía la persona desde su WhatsApp). */
export function waLink(phone: string, fullName: string, vacancyTitle: string): string {
  const digits = phone.replace(/\D/g, "");
  const text = encodeURIComponent(buildOutreachMessage(fullName, vacancyTitle, "whatsapp"));
  return `https://wa.me/${digits}?text=${text}`;
}

/** Correo con asunto y cuerpo ya armados. */
export function mailtoLink(email: string, fullName: string, vacancyTitle: string): string {
  const subject = encodeURIComponent(`Vacante de ${vacancyTitle} — ${COMPANY_NAME}`);
  const body = encodeURIComponent(buildOutreachMessage(fullName, vacancyTitle, "email"));
  return `mailto:${email}?subject=${subject}&body=${body}`;
}
