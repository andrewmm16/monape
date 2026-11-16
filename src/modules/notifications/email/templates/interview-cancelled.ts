import type { EmailContent } from "./application-received";
import { companyOf, detailsHtml, detailsText, nameOf, wrapHtml, type InterviewEmailDetails } from "./interview-shared";
import { escapeHtml } from "./html";

export type InterviewCancelledInput = InterviewEmailDetails;

/**
 * Aviso de cancelación. Muestra la entrevista que se canceló; no incluye el
 * motivo interno ni cambia el estado de la postulación.
 */
export function buildInterviewCancelledEmail(input: InterviewCancelledInput): EmailContent {
  const company = companyOf(input);
  const name = nameOf(input);
  const subject = "Tu entrevista fue cancelada";
  const text = [
    `Hola ${name},`,
    "",
    `${company} canceló la siguiente entrevista:`,
    "",
    detailsText(input),
    "",
    "Si corresponde, Recursos Humanos se pondrá en contacto contigo para coordinar una nueva fecha.",
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");
  const html = wrapHtml(
    [
      `<p>Hola ${escapeHtml(name)},</p>`,
      `<p>${escapeHtml(company)} canceló la siguiente entrevista:</p>`,
      detailsHtml(input),
      "<p>Si corresponde, Recursos Humanos se pondrá en contacto contigo para coordinar una nueva fecha.</p>",
    ].join("\n"),
  );
  return { subject, html, text };
}
