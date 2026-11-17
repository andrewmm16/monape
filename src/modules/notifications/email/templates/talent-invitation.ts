import type { EmailContent } from "./application-received";
import { escapeHtml } from "./html";

export type TalentInvitationInput = {
  fullName: string;
  vacancyTitle: string;
  companyName?: string;
};

/**
 * Invitación a una persona del histórico (base de talentos) para una vacante
 * nueva: se le avisa de que su perfil encaja y se le invita a retomar el proceso.
 * No incluye datos sensibles.
 */
export function buildTalentInvitationEmail(input: TalentInvitationInput): EmailContent {
  const company = input.companyName?.trim() || "nuestro equipo de Recursos Humanos";
  const name = input.fullName.trim() || "hola";
  const vacancy = input.vacancyTitle.trim();
  const subject = `Nueva oportunidad: ${vacancy}`;
  const text = [
    `Hola ${name},`,
    "",
    `Nos quedamos con tu perfil de un proceso anterior y se ha abierto una nueva vacante que podría encajar contigo: ${vacancy}.`,
    "",
    `Si te interesa que te consideremos, responde a este correo y una persona de ${company} te contactará con los detalles.`,
    "",
    "Si prefieres no participar, puedes ignorar este mensaje.",
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");
  const html = `<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
<p>Hola ${escapeHtml(name)},</p>
<p>Nos quedamos con tu perfil de un proceso anterior y se ha abierto una nueva vacante que podría encajar contigo: <strong>${escapeHtml(vacancy)}</strong>.</p>
<p>Si te interesa que te consideremos, responde a este correo y una persona de ${escapeHtml(company)} te contactará con los detalles.</p>
<p style="color:#6b7280;font-size:13px">Si prefieres no participar, puedes ignorar este mensaje.</p>
<p>Saludos cordiales,<br>Recursos Humanos</p>
</body></html>`;
  return { subject, html, text };
}
