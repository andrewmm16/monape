/**
 * Estado de los avisos por correo a los entrevistadores de una entrevista
 * (invitación, cambio o cancelación). Antes la pantalla decía «Avisos a N
 * entrevistadores» aunque el envío hubiera fallado; ahora cruza los correos
 * vigentes con el último resultado guardado de cada uno
 * (`interview_interviewer_notices`). Módulo puro.
 */

export type InterviewerNoticeOutcome = "enviado" | "no_enviado" | "desactivado";
export type InterviewerNoticeRow = { recipient: string; outcome: string };
export type InterviewerNoticeSummary = { total: number; sent: number; failed: number; disabled: number };
export type InterviewerNoticeLabel = { text: string; tone: "neutral" | "ok" | "warning"; hint?: string };

/** Resultado de un envío: salió, el correo está apagado en este servidor, o el servicio lo rechazó. */
export function noticeOutcomeOf(result: { sent: boolean; disabled?: boolean }): InterviewerNoticeOutcome {
  if (result.sent) return "enviado";
  return result.disabled ? "desactivado" : "no_enviado";
}

export function summarizeInterviewerNotices(
  emails: readonly string[] | null | undefined,
  notices: readonly InterviewerNoticeRow[] | null | undefined,
): InterviewerNoticeSummary {
  const outcomes = new Map((notices ?? []).map((n) => [n.recipient.trim().toLowerCase(), n.outcome]));
  const summary: InterviewerNoticeSummary = { total: 0, sent: 0, failed: 0, disabled: 0 };
  for (const email of new Set((emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))) {
    summary.total += 1;
    const outcome = outcomes.get(email);
    if (outcome === "enviado") summary.sent += 1;
    else if (outcome === "no_enviado") summary.failed += 1;
    else if (outcome === "desactivado") summary.disabled += 1;
  }
  return summary;
}

function people(count: number): string {
  return `${count} ${count === 1 ? "entrevistador" : "entrevistadores"}`;
}

/** Texto para la entrevista; null si no hay entrevistadores con correo. Nunca afirma un envío que no salió. */
export function interviewerNoticeLabel(summary: InterviewerNoticeSummary): InterviewerNoticeLabel | null {
  if (summary.total === 0) return null;
  if (summary.failed > 0) {
    return {
      text: `No se pudo avisar a ${people(summary.failed)}${summary.sent > 0 ? ` (sí a ${summary.sent})` : ""}`,
      tone: "warning",
      hint: "El servicio de correo rechazó el envío. Revise que el correo esté bien escrito; si lo está, avise a administración para que revise la configuración de correo.",
    };
  }
  if (summary.sent === summary.total) return { text: `Aviso enviado a ${people(summary.total)}`, tone: "ok" };
  if (summary.disabled > 0 && summary.sent === 0) {
    return {
      text: `${people(summary.total)} con correo · envío de correos desactivado`,
      tone: "neutral",
      hint: "Este servidor no tiene el envío de correos activado: no se avisó a nadie por correo.",
    };
  }
  // Sin resultado todavía (se está enviando, o la entrevista es anterior a este registro).
  return { text: `${people(summary.total)} con correo`, tone: "neutral" };
}
