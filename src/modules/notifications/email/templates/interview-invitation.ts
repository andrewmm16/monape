import type { EmailContent } from "./application-received";
import { companyOf, detailsHtml, detailsText, nameOf, wrapHtml, type InterviewEmailDetails } from "./interview-shared";
import { escapeHtml } from "./html";

export type InterviewInvitationInput = InterviewEmailDetails;

/** Invitación a una entrevista. Solo informa; no cambia el estado de la postulación. */
export function buildInterviewInvitationEmail(input: InterviewInvitationInput): EmailContent {
  const company = companyOf(input);
  const name = nameOf(input);
  const subject = "Invitación a entrevista";
  const text = [
    `Hola ${name},`,
    "",
    `${company} te invita a una entrevista. Estos son los datos:`,
    "",
    detailsText(input),
    "",
    "Si no puedes asistir o necesitas cambiar la fecha, responde a Recursos Humanos por los canales habituales.",
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");
  const html = wrapHtml(
    [
      `<p>Hola ${escapeHtml(name)},</p>`,
      `<p>${escapeHtml(company)} te invita a una entrevista. Estos son los datos:</p>`,
      detailsHtml(input),
      "<p>Si no puedes asistir o necesitas cambiar la fecha, responde a Recursos Humanos por los canales habituales.</p>",
    ].join("\n"),
  );
  return { subject, html, text };
}
