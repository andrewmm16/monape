import type { EmailContent } from "./application-received";
import { escapeHtml } from "./html";
import { detailsHtml, detailsText, wrapHtml, type InterviewEmailDetails } from "./interview-shared";

export type InterviewerEmailKind = "invitation" | "rescheduled" | "cancelled" | "reminder";

export type InterviewerEmailInput = Omit<InterviewEmailDetails, "fullName"> & {
  candidateName: string;
  /** Ficha de la postulación en la plataforma (solo la abre quien tiene acceso). */
  applicationUrl?: string | null;
};

const COPY: Record<InterviewerEmailKind, { subject: string; intro: string }> = {
  invitation: { subject: "Entrevista agendada", intro: "Se agendó una entrevista en la que participas:" },
  rescheduled: {
    subject: "Entrevista reprogramada",
    intro: "Cambiaron los datos de una entrevista en la que participas. Estos son los datos vigentes:",
  },
  cancelled: { subject: "Entrevista cancelada", intro: "Se canceló la siguiente entrevista en la que participabas:" },
  reminder: { subject: "Recordatorio de entrevista", intro: "Te recordamos la entrevista en la que participas:" },
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Solo enlaces http(s) a la propia plataforma; cualquier otra cosa se omite. */
function safeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Aviso a quien entrevista (agenda, cambio, cancelación o recordatorio). Lleva
 * el nombre del candidato y los datos de la entrevista; nunca el CV, la
 * evaluación ni notas internas.
 */
export function buildInterviewerEmail(kind: InterviewerEmailKind, input: InterviewerEmailInput): EmailContent {
  const copy = COPY[kind];
  const candidate = oneLine(input.candidateName) || "Candidato";
  const subject = `${copy.subject}: ${candidate}`;
  const details: InterviewEmailDetails = { ...input, fullName: candidate };
  const link = kind === "cancelled" ? null : safeLink(input.applicationUrl);

  const text = [
    "Hola,",
    "",
    copy.intro,
    "",
    `- Candidato: ${candidate}`,
    detailsText(details),
    ...(link ? ["", `Ficha de la postulación (requiere acceso a la plataforma): ${link}`] : []),
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");

  const html = wrapHtml(
    [
      "<p>Hola,</p>",
      `<p>${escapeHtml(copy.intro)}</p>`,
      `<p><strong>Candidato:</strong> ${escapeHtml(candidate)}</p>`,
      detailsHtml(details),
      ...(link
        ? [`<p><a href="${escapeHtml(link)}">Ver la ficha de la postulación</a> (requiere acceso a la plataforma).</p>`]
        : []),
    ].join("\n"),
  );
  return { subject, html, text };
}
