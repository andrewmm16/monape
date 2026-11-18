import type { EmailContent } from "./application-received";
import { escapeHtml } from "./html";

const INTRO = "Puedes ver en qué etapa va tu postulación en cualquier momento:";

/**
 * Agrega al final de un correo a la persona candidata el enlace de seguimiento
 * (portal del candidato). Sin enlace (portal apagado), devuelve el correo igual.
 * Solo acepta enlaces http(s).
 */
export function withTrackingLink(content: EmailContent, url: string | null | undefined): EmailContent {
  if (!url) return content;
  let safe: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return content;
    safe = parsed.toString();
  } catch {
    return content;
  }
  const block = `<p style="margin-top:24px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:14px;color:#4b5563">${escapeHtml(INTRO)} <a href="${escapeHtml(safe)}">Ver mi postulación</a></p>`;
  // Antes del último </body> (sin String.replace: un «$» del enlace se interpretaría como patrón).
  const end = content.html.lastIndexOf("</body>");
  const html = end === -1 ? `${content.html}\n${block}` : `${content.html.slice(0, end)}${block}\n${content.html.slice(end)}`;
  return { ...content, html, text: `${content.text}\n\n${INTRO}\n${safe}` };
}
