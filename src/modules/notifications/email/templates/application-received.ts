import { escapeHtml } from "./html";

export type ApplicationReceivedInput = {
  fullName: string;
  reference: string;
  companyName?: string;
};

export type EmailContent = { subject: string; html: string; text: string };

/** Acuse de recibo de una postulación. No incluye datos sensibles. */
export function buildApplicationReceivedEmail(input: ApplicationReceivedInput): EmailContent {
  const company = input.companyName?.trim() || "nuestro equipo de Recursos Humanos";
  const name = input.fullName.trim() || "postulante";
  const subject = "Hemos recibido tu postulación";
  const text = [
    `Hola ${name},`,
    "",
    `Gracias por postular. Confirmamos que ${company} recibió tu postulación correctamente.`,
    "",
    `Tu referencia es: ${input.reference}`,
    "",
    "Una persona del área de Recursos Humanos revisará tu perfil. Si avanzas en el proceso, nos pondremos en contacto contigo por este medio.",
    "",
    "Este es un mensaje automático de confirmación; no es necesario responderlo.",
    "",
    "Saludos cordiales,",
    "Recursos Humanos",
  ].join("\n");
  const html = `<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
<p>Hola ${escapeHtml(name)},</p>
<p>Gracias por postular. Confirmamos que ${escapeHtml(company)} recibió tu postulación correctamente.</p>
<p>Tu referencia es: <strong>${escapeHtml(input.reference)}</strong></p>
<p>Una persona del área de Recursos Humanos revisará tu perfil. Si avanzas en el proceso, nos pondremos en contacto contigo por este medio.</p>
<p style="color:#6b7280;font-size:13px">Este es un mensaje automático de confirmación; no es necesario responderlo.</p>
<p>Saludos cordiales,<br>Recursos Humanos</p>
</body></html>`;
  return { subject, html, text };
}
