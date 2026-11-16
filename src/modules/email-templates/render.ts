import type { EmailContent } from "@/modules/notifications/email/templates/application-received";
import {
  resolveStatusVars,
  wrapStatusEmail,
  type ApplicationStatusEmailInput,
} from "@/modules/notifications/email/templates/application-status-shared";
import { substituteVariables, type EmailTemplateContent } from "./defaults";

/**
 * Convierte una plantilla editable (asunto + cuerpo con variables) en el correo
 * que se envía. El cuerpo separa párrafos por líneas en blanco. Usa el mismo
 * envoltorio que los correos del código y nunca añade datos internos.
 */
export function renderEditableTemplate(content: EmailTemplateContent, input: ApplicationStatusEmailInput): EmailContent {
  const resolved = resolveStatusVars(input);
  const vars = { nombre: resolved.name, vacante: resolved.vacancy, empresa: resolved.company };
  const subject = substituteVariables(content.subject, vars).trim() || "Novedades sobre tu postulación";
  const paragraphs = substituteVariables(content.body, vars)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return wrapStatusEmail(resolved.name, subject, paragraphs);
}
