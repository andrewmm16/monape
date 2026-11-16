import type { EmailContent } from "./application-received";
import { escapeHtml } from "./html";

/**
 * Correo libre que RRHH redacta para una persona candidata. A diferencia de los
 * correos de estado, el cuerpo es exactamente el que escribe RRHH (sin saludo ni
 * despedida automáticos): quien escribe decide el tono y el contenido completo.
 */
export function buildCandidateMessageEmail(subject: string, body: string): EmailContent {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const text = paragraphs.join("\n\n");
  const html = `<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("\n")}
</body></html>`;
  return { subject, html, text };
}
