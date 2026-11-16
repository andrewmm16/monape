import type { EmailContent } from "./application-received";
import { companyOf, detailsHtml, detailsText, nameOf, wrapHtml, type InterviewEmailDetails } from "./interview-shared";
import { escapeHtml } from "./html";

export type InterviewReminderInput = InterviewEmailDetails;

/** Recordatorio de una entrevista próxima. Solo informa; no cambia ningún estado. */
export function buildInterviewReminderEmail(input: InterviewReminderInput): EmailContent {
  const company = companyOf(input);
  const name = nameOf(input);
  const subject = "Recordatorio de tu entrevista";
  const text = [
    `Hola ${name},`,
    "",
    `Te recordamos que tienes una entrevista con ${company}:`,
    "",
    detailsText(input),
    "",
    "Si no puedes asistir, avisa a Recursos Humanos por los canales habituales.",
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");
  const html = wrapHtml(
    [
      `<p>Hola ${escapeHtml(name)},</p>`,
      `<p>Te recordamos que tienes una entrevista con ${escapeHtml(company)}:</p>`,
      detailsHtml(input),
      "<p>Si no puedes asistir, avisa a Recursos Humanos por los canales habituales.</p>",
    ].join("\n"),
  );
  return { subject, html, text };
}
