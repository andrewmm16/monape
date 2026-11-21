import "server-only";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { sendEmail } from "@/modules/notifications/email/client";
import { getEmailAvailability } from "@/modules/notifications/email/config";
import type { EmailContent } from "@/modules/notifications/email/templates/application-received";
import { buildInterviewBookingEmail } from "@/modules/notifications/email/templates/interview-booking";
import { buildInterviewCancelledEmail } from "@/modules/notifications/email/templates/interview-cancelled";
import { buildInterviewInvitationEmail } from "@/modules/notifications/email/templates/interview-invitation";
import { buildInterviewerEmail } from "@/modules/notifications/email/templates/interview-interviewer";
import { buildInterviewReminderEmail } from "@/modules/notifications/email/templates/interview-reminder";
import { buildInterviewRescheduledEmail } from "@/modules/notifications/email/templates/interview-rescheduled";
import type { InterviewEmailDetails } from "@/modules/notifications/email/templates/interview-shared";
import { withTrackingLink } from "@/modules/notifications/email/templates/tracking-footer";
import { getTrackingUrlForEmail } from "@/modules/candidate-portal/queries";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { noticeOutcomeOf } from "./notices";

export type InterviewEmailKind = "invitation" | "rescheduled" | "cancelled" | "reminder";

/** A quién va el correo: la persona candidata o uno de los entrevistadores. */
export type InterviewEmailRecipient = { kind: "candidato" } | { kind: "entrevistador"; email: string };

/** `disabled`: no salió porque el envío de correos está apagado en este servidor. */
type SendOutcome = { sent: boolean; withoutEmail?: boolean; disabled?: boolean };

/** Guarda si el aviso a un entrevistador salió, para no mostrar «avisado» si falló. Nunca lanza. */
async function recordInterviewerNotice(interviewId: string, email: string, outcome: SendOutcome): Promise<void> {
  try {
    const { error } = await createSupabaseAdminClient().rpc("record_interviewer_notice", {
      p_interview_id: interviewId,
      p_recipient: email,
      p_outcome: noticeOutcomeOf(outcome),
    });
    if (error) throw error;
  } catch (error) {
    logServerError("interview.email.notice", error);
  }
}

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
async function deliver(
  supabase: AppSupabaseClient,
  data: InterviewEmailData,
  kind: InterviewEmailKind,
  recipient: InterviewEmailRecipient,
): Promise<SendOutcome> {
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
    // Con el portal del candidato encendido, el correo lleva su enlace de seguimiento.
    content = withTrackingLink(
      CANDIDATE_BUILDERS[kind]({ ...details, fullName: candidate?.full_name ?? "" }),
      to ? await getTrackingUrlForEmail(supabase, data.application_id) : null,
    );
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
  return { sent: result.sent, disabled: !result.sent && "reason" in result && Boolean(result.reason) };
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
    return await deliver(supabase, data, kind, recipient);
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
    await deliver(supabase, data, kind, { kind: "candidato" });
    const added = new Set(addedInterviewers.map((email) => email.toLowerCase()));
    for (const email of data.interviewer_emails ?? []) {
      const interviewerKind = kind === "rescheduled" && added.has(email) ? "invitation" : kind;
      const outcome = await deliver(supabase, data, interviewerKind, { kind: "entrevistador", email });
      await recordInterviewerNotice(data.id, email, outcome);
    }
  } catch (error) {
    logServerError("interview.email", error);
  }
}

/**
 * Autoagenda: correo a la persona candidata con su enlace y los horarios
 * ofrecidos. Devuelve si salió; sin correo (o con el envío desactivado) RRHH
 * copia el enlace del diálogo. Nunca lanza.
 */
export async function sendBookingInvitationEmail(supabase: AppSupabaseClient, offerId: string, url: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("interview_booking_offers")
      .select(
        "id, application_id, duration_minutes, modality, expires_at, interview_booking_slots(starts_at), applications!inner(candidates(full_name, email), vacancies(title))",
      )
      .eq("id", offerId)
      .maybeSingle();
    if (error) throw error;
    const to = data?.applications?.candidates?.email?.trim();
    if (!data || !to) {
      console.info(`[interview.booking.email] offer_id=${offerId} estado=sin_correo`);
      return false;
    }
    const content = buildInterviewBookingEmail({
      fullName: data.applications?.candidates?.full_name ?? "",
      companyName: getServerEnv().PUBLIC_COMPANY_NAME,
      vacancyTitle: data.applications?.vacancies?.title ?? "",
      durationMinutes: data.duration_minutes,
      modality: data.modality,
      slots: (data.interview_booking_slots ?? []).map((slot) => slot.starts_at),
      expiresAt: data.expires_at,
      url,
    });
    const result = await sendEmail({ to, subject: content.subject, html: content.html, text: content.text, tags: [{ name: "type", value: "interview_booking" }] });
    console.info(`[interview.booking.email] offer_id=${offerId} application_id=${data.application_id} estado=${result.sent ? "enviado" : "no_enviado"}`);
    return result.sent;
  } catch (error) {
    logServerError("interview.booking.email", error);
    return false;
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
      outcome = interview ? await deliver(admin, interview, "reminder", recipient) : { sent: false, withoutEmail: true };
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
