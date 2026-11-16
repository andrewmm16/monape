import type { EmailContent } from "./application-received";
import { renderStatusEmail, type ApplicationStatusEmailInput } from "./application-status-shared";

/** Agradecimiento respetuoso: la persona no continúa en el proceso. No incluye motivos internos ni promete futuras oportunidades. */
export function buildApplicationRejectedEmail(input: ApplicationStatusEmailInput): EmailContent {
  return renderStatusEmail(input, "Novedades sobre tu postulación", ({ vacancy, company }) => [
    `Gracias por tu interés en ${vacancy} y por el tiempo dedicado a participar en el proceso de ${company}.`,
    "Tras revisar las postulaciones, hemos decidido continuar con otros perfiles y tu candidatura no seguirá en este proceso.",
    "Valoramos que nos hayas considerado y te deseamos éxito en tu búsqueda profesional.",
  ]);
}
