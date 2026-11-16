import "server-only";
import { after } from "next/server";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { isEmailTemplateKey } from "@/modules/email-templates/defaults";
import { getEditedTemplate } from "@/modules/email-templates/queries";
import { renderEditableTemplate } from "@/modules/email-templates/render";
import { sendEmail } from "@/modules/notifications/email/client";
import type { EmailContent } from "@/modules/notifications/email/templates/application-received";
import { buildApplicationInterviewEmail } from "@/modules/notifications/email/templates/application-status-interview";
import { buildApplicationRejectedEmail } from "@/modules/notifications/email/templates/application-status-rejected";
import { buildApplicationSelectedEmail } from "@/modules/notifications/email/templates/application-status-selected";
import type { ApplicationStatusEmailInput } from "@/modules/notifications/email/templates/application-status-shared";
import type { Enums } from "@/types/database";
import { isCommunicableStatus } from "./communicable";

type Status = Enums<"application_status">;

const BUILDERS: Partial<Record<Status, (input: ApplicationStatusEmailInput) => EmailContent>> = {
  entrevista_programada: buildApplicationInterviewEmail,
  seleccionado: buildApplicationSelectedEmail,
  no_seleccionado: buildApplicationRejectedEmail,
};

export type StatusEmailResult = "enviado" | "no_enviado" | "sin_correo" | "no_comunicable";

/**
 * Informa del nuevo estado a la persona candidata. Solo informa: no cambia
 * estados ni decide nada. Nunca lanza y no registra la dirección ni el
 * contenido, solo identificadores y el resultado.
 */
export async function sendApplicationStatusEmail(
  supabase: AppSupabaseClient,
  applicationId: string,
  status: Status,
): Promise<StatusEmailResult> {
  const build = BUILDERS[status];
  if (!build) return "no_comunicable";
  let result: StatusEmailResult;
  try {
    const { data, error } = await supabase
      .from("applications")
      .select("id, candidates(full_name, email), vacancies(title)")
      .eq("id", applicationId)
      .maybeSingle();
    if (error) throw error;
    const email = data?.candidates?.email?.trim();
    if (!data || !email) {
      result = "sin_correo";
    } else {
      const templateInput = {
        fullName: data.candidates?.full_name ?? "",
        vacancyTitle: data.vacancies?.title ?? null,
        companyName: getServerEnv().PUBLIC_COMPANY_NAME,
      };
      // Versión editada por RRHH si existe; si no, el texto por defecto del código.
      const edited = isEmailTemplateKey(status) ? await getEditedTemplate(supabase, status) : null;
      const content = edited ? renderEditableTemplate(edited, templateInput) : build(templateInput);
      const sent = await sendEmail({
        to: email,
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags: [{ name: "type", value: `application_status_${status}` }],
      });
      result = sent.sent ? "enviado" : "no_enviado";
    }
  } catch (error) {
    logServerError("application.status_email", error);
    return "no_enviado";
  }
  console.info(`[application.status_email] application_id=${applicationId} estado=${status} resultado=${result}`);
  return result;
}

/** Envío diferido (`after`), fuera del camino crítico. Nunca lanza. */
export function scheduleApplicationStatusEmail(supabase: AppSupabaseClient, applicationId: string, status: Status): void {
  if (!isCommunicableStatus(status)) return;
  try {
    after(async () => {
      await sendApplicationStatusEmail(supabase, applicationId, status);
    });
  } catch (error) {
    logServerError("application.status_email", error);
  }
}
