import "server-only";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { sendEmail } from "@/modules/notifications/email/client";
import { getEmailAvailability } from "@/modules/notifications/email/config";
import type { EmailContent } from "@/modules/notifications/email/templates/application-received";
import { buildInterviewCancelledEmail } from "@/modules/notifications/email/templates/interview-cancelled";
import { buildInterviewInvitationEmail } from "@/modules/notifications/email/templates/interview-invitation";
import { buildInterviewerEmail } from "@/modules/notifications/email/templates/interview-interviewer";
import { buildInterviewReminderEmail } from "@/modules/notifications/email/templates/interview-reminder";
import { buildInterviewRescheduledEmail } from "@/modules/notifications/email/templates/interview-rescheduled";
import type { InterviewEmailDetails } from "@/modules/notifications/email/templates/interview-shared";

export type InterviewEmailKind = "invitation" | "rescheduled" | "cancelled" | "reminder";

/** A quién va el correo: la persona candidata o uno de los entrevistadores. */
export type InterviewEmailRecipient = { kind: "candidato" } | { kind: "entrevistador"; email: string };

type SendOutcome = { sent: boolean; withoutEmail?: boolean };

const CANDIDATE_BUILDERS: Record<InterviewEmailKind, (details: InterviewEmailDetails) => EmailContent> = {
  invitation: buildInterviewInvitationEmail,
  rescheduled: buildInterviewRescheduledEmail,
  cancelled: buildInterviewCancelledEmail,
  reminder: buildInterviewReminderEmail,
};

const SELECT =
  "id, application_id, scheduled_at, duration_minutes, modality, location, instructions, interviewer_emails, applications!inner(candidates(full_name, email), vacancies(title))";

async function loadInterview(supabase: AppSupabaseClient, interviewId: string) {
  const { data, error } = await supabase.from("interviews").select(SELECT).eq("id", interviewId).maybeSingle();
  if (error) throw error;
  return data;
}

type InterviewEmailData = NonNullable<Awaited<ReturnType<typeof loadInterview>>>;

/**
 * Envía un correo de la entrevista a un destinatario. No registra la dirección
 * ni el contenido: solo identificadores, el tipo de destinatario y el estado.
 */
async function deliver(data: InterviewEmailData, kind: InterviewEmailKind, recipient: InterviewEmailRecipient): Promise<SendOutcome> {
  const env = getServerEnv();
  const candidate = data.applications?.candidates;
  const details = {
    companyName: env.PUBLIC_COMPANY_NAME,
    vacancyTitle: data.applications?.vacancies?.title ?? null,
    scheduledAt: data.scheduled_at,
    durationMinutes: data.duration_minutes,
    modality: data.modality,
    location: data.location,
    instructions: data.instructions,
  };

  let to: string | undefined;
  let content: EmailContent;
  if (recipient.kind === "candidato") {
    to = candidate?.email?.trim();
    content = CANDIDATE_BUILDERS[kind]({ ...details, fullName: candidate?.full_name ?? "" });
  } else {
    to = recipient.email.trim();
    content = buildInterviewerEmail(kind, {
      ...details,
      candidateName: candidate?.full_name ?? "",
      applicationUrl: new URL(`/postulaciones/${data.application_id}`, env.APP_URL).toString(),
    });
  }
  const log = (estado: string) =>
    console.info(
      `[interview.email] interview_id=${data.id} application_id=${data.application_id} destinatario=${recipient.kind} tipo=${kind} estado=${estado}`,
    );
  if (!to) {
    log("sin_correo");
    return { sent: false, withoutEmail: true };
  }
  const result = await sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    tags: [{ name: "type", value: `${recipient.kind === "candidato" ? "interview" : "interviewer"}_${kind}` }],
  });
  log(result.sent ? "enviado" : "no_enviado");
  return { sent: result.sent };
}

/** Correo de una entrevista a un destinatario (por defecto, la persona candidata). Nunca lanza. */
export async function sendInterviewEmail(
  supabase: AppSupabaseClient,
  kind: InterviewEmailKind,
  interviewId: string,
  recipient: InterviewEmailRecipient = { kind: "candidato" },
): Promise<SendOutcome> {
  try {
    const data = await loadInterview(supabase, interviewId);
    if (!data) {
      console.info(`[interview.email] interview_id=${interviewId} tipo=${kind} estado=no_encontrada`);
      return { sent: false, withoutEmail: true };
    }
    return await deliver(data, kind, recipient);
  } catch (error) {
    logServerError("interview.email", error);
    return { sent: false };
  }
}

/**
 * Avisa de la entrevista a la persona candidata y a cada entrevistador con
 * correo. Al reprogramar, quien se suma en ese momento (`addedInterviewers`)
 * recibe la invitación en lugar del aviso de cambio. Nunca lanza.
 */
async function notifyInterview(
  supabase: AppSupabaseClient,
  kind: Exclude<InterviewEmailKind, "reminder">,
  interviewId: string,
  addedInterviewers: readonly string[] = [],
): Promise<void> {
  try {
    const data = await loadInterview(supabase, interviewId);
    if (!data) return;
    await deliver(data, kind, { kind: "candidato" });
    const added = new Set(addedInterviewers.map((email) => email.toLowerCase()));
    for (const email of data.interviewer_emails ?? []) {
      const interviewerKind = kind === "rescheduled" && added.has(email) ? "invitation" : kind;
      await deliver(data, interviewerKind, { kind: "entrevistador", email });
    }
  } catch (error) {
    logServerError("interview.email", error);
  }
}

/** Correos diferidos (`after`), fuera del camino crítico. Nunca lanza. */
export function scheduleInterviewEmail(
  supabase: AppSupabaseClient,
  kind: Exclude<InterviewEmailKind, "reminder">,
  interviewId: string,
  options: { addedInterviewers?: readonly string[] } = {},
): void {
  try {
    after(async () => {
      await notifyInterview(supabase, kind, interviewId, options.addedInterviewers);
    });
  } catch (error) {
    logServerError("interview.email", error);
  }
}

export type ReminderRunResult =
  | { status: "omitida"; reason: string }
  | { status: "ejecutada"; claimed: number; sent: number; withoutEmail: number; failed: number };

/** Ventana del recordatorio: entrevistas que empiezan dentro de estas horas. */
export const REMINDER_HOURS_BEFORE = 24;
/** No se recuerda una entrevista agendada o modificada hace menos de estas horas. */
export const REMINDER_MIN_NOTICE_HOURS = 12;

/**
 * Tarea programada (GET /api/tareas/recordatorios-entrevista, con el cliente de
 * servicio): envía el recordatorio de las entrevistas «programada» que empiezan
 * dentro de 24 h a la persona candidata y a cada entrevistador con correo. La BD
 * reserva cada recordatorio (uno por entrevista, fecha y destinatario), así que
 * se puede ejecutar con cualquier frecuencia sin duplicar envíos. Si el correo
 * está desactivado no reserva nada: los recordatorios salen cuando se active.
 */
export async function sendDueInterviewReminders(admin: AppSupabaseClient): Promise<ReminderRunResult> {
  const availability = getEmailAvailability();
  if (!availability.available) return { status: "omitida", reason: availability.reason };

  const { data, error } = await admin.rpc("claim_due_interview_reminders", {
    p_hours_before: REMINDER_HOURS_BEFORE,
    p_min_notice_hours: REMINDER_MIN_NOTICE_HOURS,
  });
  if (error) throw error;

  // Las columnas de una función `returns table` llegan tipadas como opcionales; nunca son nulas.
  const reminders = (data ?? []).flatMap((row) =>
    row.interview_id && row.scheduled_at && row.recipient
      ? [{ interview_id: row.interview_id, scheduled_at: row.scheduled_at, recipient: row.recipient }]
      : [],
  );
  const result = { status: "ejecutada" as const, claimed: reminders.length, sent: 0, withoutEmail: 0, failed: 0 };
  const interviews = new Map<string, InterviewEmailData | null>();
  for (const reminder of reminders) {
    let outcome: SendOutcome;
    try {
      if (!interviews.has(reminder.interview_id)) {
        interviews.set(reminder.interview_id, await loadInterview(admin, reminder.interview_id));
      }
      const interview = interviews.get(reminder.interview_id);
      const recipient: InterviewEmailRecipient =
        reminder.recipient === "candidato" ? { kind: "candidato" } : { kind: "entrevistador", email: reminder.recipient };
      outcome = interview ? await deliver(interview, "reminder", recipient) : { sent: false, withoutEmail: true };
    } catch (sendError) {
      logServerError("interview.reminder", sendError);
      outcome = { sent: false };
    }
    const status = outcome.sent ? "enviado" : outcome.withoutEmail ? "sin_correo" : "error";
    if (status === "enviado") result.sent++;
    else if (status === "sin_correo") result.withoutEmail++;
    else result.failed++;
    const { error: finishError } = await admin.rpc("finish_interview_reminder", {
      p_interview_id: reminder.interview_id,
      p_scheduled_at: reminder.scheduled_at,
      p_recipient: reminder.recipient,
      p_outcome: status,
    });
    // No corta el lote: la reserva queda «enviando» y la BD la libera a los
    // 30 min (en el peor caso, un recordatorio duplicado).
    if (finishError) logServerError("interview.reminder", finishError);
  }
  return result;
}
