import { formatDuration, formatInterviewDateTime } from "@/modules/interviews/datetime";
import type { EmailContent } from "./application-received";
import { escapeHtml } from "./html";
import { companyOf, nameOf, wrapHtml } from "./interview-shared";

const MODALITY_TEXT = { presencial: "presencial", virtual: "virtual", telefonica: "telefónica" } as const;

export type InterviewBookingEmailInput = {
  fullName: string;
  companyName?: string;
  vacancyTitle: string;
  durationMinutes: number;
  modality: keyof typeof MODALITY_TEXT;
  /** Horarios ofrecidos (instantes ISO); se muestran en hora de Lima. */
  slots: string[];
  /** Hasta cuándo puede elegir (ISO). */
  expiresAt: string;
  url: string;
};

/** Invitación a elegir el horario de la entrevista (autoagenda). Tutea como los demás correos a candidatos. Sin datos de otras personas. */
export function buildInterviewBookingEmail(input: InterviewBookingEmailInput): EmailContent {
  const company = companyOf(input);
  const name = nameOf(input);
  const slots = [...input.slots].sort().map(formatInterviewDateTime);
  const subject = `Elige el horario de tu entrevista · ${input.vacancyTitle}`;
  const intro = `${company} te invita a una entrevista ${MODALITY_TEXT[input.modality]} de ${formatDuration(input.durationMinutes)} para el puesto «${input.vacancyTitle}». Elige el horario que mejor te acomode:`;
  const deadline = `Puedes elegir hasta el ${formatInterviewDateTime(input.expiresAt)} (hora de Lima). Si ningún horario te sirve, responde a Recursos Humanos por los canales habituales.`;
  const text = [
    `Hola ${name},`,
    "",
    intro,
    "",
    ...slots.map((slot) => `- ${slot} (hora de Lima)`),
    "",
    `Elige aquí: ${input.url}`,
    "",
    deadline,
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");
  const html = wrapHtml(
    [
      `<p>Hola ${escapeHtml(name)},</p>`,
      `<p>${escapeHtml(intro)}</p>`,
      `<ul>${slots.map((slot) => `<li>${escapeHtml(slot)} (hora de Lima)</li>`).join("")}</ul>`,
      `<p><a href="${escapeHtml(input.url)}">Elegir mi horario</a></p>`,
      `<p>${escapeHtml(deadline)}</p>`,
    ].join("\n"),
  );
  return { subject, html, text };
}
