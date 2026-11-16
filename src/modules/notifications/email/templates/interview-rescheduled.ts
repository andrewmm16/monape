import type { EmailContent } from "./application-received";
import { companyOf, detailsHtml, detailsText, nameOf, wrapHtml, type InterviewEmailDetails } from "./interview-shared";
import { escapeHtml } from "./html";

export type InterviewRescheduledInput = InterviewEmailDetails;

/** Aviso de reprogramación con la nueva fecha. Solo informa; no cambia ningún estado. */
export function buildInterviewRescheduledEmail(input: InterviewRescheduledInput): EmailContent {
  const company = companyOf(input);
  const name = nameOf(input);
  const subject = "Tu entrevista fue reprogramada";
  const text = [
    `Hola ${name},`,
    "",
    `${company} reprogramó tu entrevista. Los nuevos datos son:`,
    "",
    detailsText(input),
    "",
    "Esta información reemplaza a la que recibiste antes. Si no puedes asistir, responde a Recursos Humanos por los canales habituales.",
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");
  const html = wrapHtml(
    [
      `<p>Hola ${escapeHtml(name)},</p>`,
      `<p>${escapeHtml(company)} reprogramó tu entrevista. Los nuevos datos son:</p>`,
      detailsHtml(input),
      "<p>Esta información reemplaza a la que recibiste antes. Si no puedes asistir, responde a Recursos Humanos por los canales habituales.</p>",
    ].join("\n"),
  );
  return { subject, html, text };
}
