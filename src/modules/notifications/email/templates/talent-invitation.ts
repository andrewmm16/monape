import {
  EMAIL_TEMPLATE_DEFAULTS,
  substituteVariables,
  talentInvitationFooter,
  type EmailTemplateContent,
} from "@/modules/email-templates/defaults";
import type { EmailContent } from "./application-received";
import { resolveStatusVars } from "./application-status-shared";
import { escapeHtml } from "./html";

export type TalentInvitationInput = {
  fullName: string;
  vacancyTitle: string;
  companyName?: string;
  /** Página pública de la vacante; sin ella el correo no lleva botón. */
  vacancyUrl?: string | null;
  /** Versión editada por RRHH en Configuración; sin ella, el texto por defecto. */
  template?: EmailTemplateContent | null;
};

/** Solo direcciones http(s): nunca se pone en el correo un enlace de otro tipo. */
function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Invitación a una persona de la base de talentos para una vacante nueva. El
 * texto (asunto y párrafos) es editable por RRHH; el saludo, el botón «Ver la
 * vacante», la firma y la nota final (por qué recibe el correo y cómo pedir la
 * baja) los pone siempre el sistema. No incluye datos sensibles.
 */
export function buildTalentInvitationEmail(input: TalentInvitationInput): EmailContent {
  const resolved = resolveStatusVars({
    fullName: input.fullName,
    vacancyTitle: input.vacancyTitle,
    companyName: input.companyName,
  });
  const vars = { nombre: resolved.name, vacante: resolved.vacancy, empresa: resolved.company };
  const defaults = EMAIL_TEMPLATE_DEFAULTS.invitacion_cartera;
  const content = input.template ?? defaults;
  const subject = substituteVariables(content.subject, vars).trim() || defaults.subject;
  const paragraphs = substituteVariables(content.body, vars)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const url = safeUrl(input.vacancyUrl);
  const company = input.companyName?.trim() || null;
  const signature = company ? `Recursos Humanos · ${company}` : "Recursos Humanos";
  const footer = talentInvitationFooter(resolved.company);

  const text = [
    `Hola ${resolved.name},`,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...(url ? [`Ver la vacante: ${url}`, ""] : []),
    "Saludos cordiales,",
    signature,
    "",
    "—",
    footer,
  ].join("\n");

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f2f2f0;font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
${company ? `<p style="margin:0 0 16px;font-weight:bold;color:#0b7a4b">${escapeHtml(company)}</p>\n` : ""}<p>Hola ${escapeHtml(resolved.name)},</p>
${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")}
${url ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0b7a4b;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:6px">Ver la vacante</a></p>\n` : ""}<p>Saludos cordiales,<br>${escapeHtml(signature)}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
<p style="margin:0;color:#6b7280;font-size:12px">${escapeHtml(footer)}</p>
</div>
</body></html>`;

  return { subject, html, text };
}
