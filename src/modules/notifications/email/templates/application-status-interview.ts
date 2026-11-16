import type { EmailContent } from "./application-received";
import { renderStatusEmail, type ApplicationStatusEmailInput } from "./application-status-shared";

/** Aviso informativo: la persona fue citada a entrevista. */
export function buildApplicationInterviewEmail(input: ApplicationStatusEmailInput): EmailContent {
  return renderStatusEmail(input, "Te invitamos a una entrevista", ({ vacancy, company }) => [
    `Te escribimos de parte de ${company} para contarte que tu postulación a ${vacancy} avanzó a la etapa de entrevista.`,
    "Nuestro equipo de Recursos Humanos coordinará contigo los detalles. Revisa también tu carpeta de correo no deseado.",
  ]);
}
