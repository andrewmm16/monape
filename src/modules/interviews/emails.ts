import "server-only";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { sendEmail } from "@/modules/notifications/email/client";
import type { EmailContent } from "@/modules/notifications/email/templates/application-received";
import { buildInterviewCancelledEmail } from "@/modules/notifications/email/templates/interview-cancelled";
import { buildInterviewInvitationEmail } from "@/modules/notifications/email/templates/interview-invitation";
import { buildInterviewReminderEmail } from "@/modules/notifications/email/templates/interview-reminder";
import { buildInterviewRescheduledEmail } from "@/modules/notifications/email/templates/interview-rescheduled";
import type { InterviewEmailDetails } from "@/modules/notifications/email/templates/interview-shared";

export type InterviewEmailKind = "invitation" | "rescheduled" | "cancelled" | "reminder";

const BUILDERS: Record<InterviewEmailKind, (details: InterviewEmailDetails) => EmailContent> = {
  invitation: buildInterviewInvitationEmail,
  rescheduled: buildInterviewRescheduledEmail,
  cancelled: buildInterviewCancelledEmail,
  reminder: buildInterviewReminderEmail,
};

const SELECT =
  "id, application_id, scheduled_at, duration_minutes, modality, location, instructions, applications!inner(candidates(full_name, email), vacancies(title))";

/**
 * Envía a la persona candidata el correo de una entrevista. Nunca lanza y no
 * registra la dirección ni el contenido: solo identificadores y el estado.
 *
 * Los entrevistadores no reciben correo: en el modelo (`interviews.interviewers`)
 * son nombres libres de texto, sin dirección de correo.
 */
export async function sendInterviewEmail(
  supabase: AppSupabaseClient,
  kind: InterviewEmailKind,
  interviewId: string,
): Promise<{ sent: boolean }> {
  try {
    const { data, error } = await supabase.from("interviews").select(SELECT).eq("id", interviewId).maybeSingle();
    if (error) throw error;
    const candidate = data?.applications?.candidates;
    const email = candidate?.email?.trim();
    if (!data || !email) {
      console.info(`[interview.email] interview_id=${interviewId} tipo=${kind} estado=sin_correo`);
      return { sent: false };
    }
    const content = BUILDERS[kind]({
      fullName: candidate?.full_name ?? "",
      companyName: getServerEnv().PUBLIC_COMPANY_NAME,
      vacancyTitle: data.applications?.vacancies?.title ?? null,
      scheduledAt: data.scheduled_at,
      durationMinutes: data.duration_minutes,
      modality: data.modality,
      location: data.location,
      instructions: data.instructions,
    });
    const result = await sendEmail({
      to: email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      tags: [{ name: "type", value: `interview_${kind}` }],
    });
    console.info(
      `[interview.email] interview_id=${interviewId} application_id=${data.application_id} tipo=${kind} estado=${result.sent ? "enviado" : "no_enviado"}`,
    );
    return { sent: result.sent };
  } catch (error) {
    logServerError("interview.email", error);
    return { sent: false };
  }
}

/** Correo diferido (`after`), fuera del camino crítico. Nunca lanza. */
export function scheduleInterviewEmail(supabase: AppSupabaseClient, kind: InterviewEmailKind, interviewId: string): void {
  try {
    after(async () => {
      await sendInterviewEmail(supabase, kind, interviewId);
    });
  } catch (error) {
    logServerError("interview.email", error);
  }
}

/**
 * TODO(recordatorio automático): un cron del despliegue debe invocar esto con un
 * cliente de servicio. No hay scheduler en el repo; esta función queda lista.
 * Envía el recordatorio a las entrevistas «programada» que empiezan dentro de
 * `hoursBefore` horas. Para no duplicar envíos, el cron debe ejecutarse con una
 * periodicidad ≤ a la ventana y se necesitará marcar lo enviado (p. ej. una
 * columna `reminder_sent_at`; no existe hoy). Devuelve cuántos se enviaron.
 */
export async function sendDueInterviewReminders(
  supabase: AppSupabaseClient,
  hoursBefore = 24,
  now: Date = new Date(),
): Promise<number> {
  try {
    const until = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);
    const { data, error } = await supabase
      .from("interviews")
      .select("id")
      .eq("status", "programada")
      .gte("scheduled_at", now.toISOString())
      .lt("scheduled_at", until.toISOString());
    if (error) throw error;
    let sent = 0;
    for (const row of data ?? []) {
      if ((await sendInterviewEmail(supabase, "reminder", row.id)).sent) sent++;
    }
    return sent;
  } catch (error) {
    logServerError("interview.email", error);
    return 0;
  }
}
