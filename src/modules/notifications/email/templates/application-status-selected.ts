import type { EmailContent } from "./application-received";
import { renderStatusEmail, type ApplicationStatusEmailInput } from "./application-status-shared";

/** Felicitación sobria: la persona fue seleccionada. */
export function buildApplicationSelectedEmail(input: ApplicationStatusEmailInput): EmailContent {
  return renderStatusEmail(input, "Novedades sobre tu postulación", ({ vacancy, company }) => [
    `Nos alegra comunicarte que fuiste seleccionado/a en el proceso de ${vacancy} de ${company}.`,
    "Una persona del área de Recursos Humanos se pondrá en contacto contigo por este medio para coordinar los siguientes pasos.",
    "Gracias por tu interés y por el tiempo dedicado al proceso.",
  ]);
}
