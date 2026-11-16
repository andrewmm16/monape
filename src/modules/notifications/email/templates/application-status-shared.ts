import type { EmailContent } from "./application-received";
import { escapeHtml } from "./html";

export type ApplicationStatusEmailInput = {
  fullName: string;
  vacancyTitle?: string | null;
  companyName?: string;
};

export type StatusVars = { name: string; vacancy: string; company: string };

/**
 * Resuelve los valores que sustituyen a las variables del correo. Un valor
 * ausente usa un texto neutro, nunca deja la variable sin resolver.
 */
export function resolveStatusVars(input: ApplicationStatusEmailInput): StatusVars {
  return {
    name: input.fullName.trim() || "postulante",
    vacancy: input.vacancyTitle?.trim() ? `la vacante «${input.vacancyTitle.trim()}»` : "la vacante a la que postulaste",
    company: input.companyName?.trim() || "nuestro equipo de Recursos Humanos",
  };
}

/** Envoltorio común de los correos informativos (saludo, párrafos y despedida). */
export function wrapStatusEmail(name: string, subject: string, paragraphs: string[]): EmailContent {
  const text = [`Hola ${name},`, "", ...paragraphs.flatMap((p) => [p, ""]), "Saludos cordiales,", "Recursos Humanos"].join("\n");
  const html = `<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
<p>Hola ${escapeHtml(name)},</p>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n")}
<p>Saludos cordiales,<br>Recursos Humanos</p>
</body></html>`;
  return { subject, html, text };
}

/**
 * Arma un correo informativo de cambio de estado a partir de párrafos fijos.
 * Nunca incluye el motivo ni las observaciones internas de RRHH.
 */
export function renderStatusEmail(
  input: ApplicationStatusEmailInput,
  subject: string,
  paragraphs: (context: { vacancy: string; company: string }) => string[],
): EmailContent {
  const vars = resolveStatusVars(input);
  return wrapStatusEmail(vars.name, subject, paragraphs({ vacancy: vars.vacancy, company: vars.company }));
}
