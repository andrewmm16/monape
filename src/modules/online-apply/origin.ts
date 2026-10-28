/** Portales del catálogo que puede fijar el formulario público. */
export const DEFAULT_PORTAL = "Página de empleos";
export const GOOGLE_PORTAL = "Google";
export type ApplyPortal = typeof DEFAULT_PORTAL | typeof GOOGLE_PORTAL;

/** google.com, google.com.pe, google.co.uk, google.pe… (con o sin subdominio). */
const GOOGLE_HOST = /(^|\.)google\.(?:com|[a-z]{2,3})(?:\.[a-z]{2})?$/;

/**
 * Portal de origen según `document.referrer`: si el dominio es de Google,
 * «Google»; en cualquier otro caso (incluido un valor vacío o inválido),
 * «Página de empleos». El valor lo envía el navegador y solo clasifica el origen.
 */
export function portalFromReferrer(referrer: string | null | undefined): ApplyPortal {
  if (!referrer || referrer.length > 2048) return DEFAULT_PORTAL;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return DEFAULT_PORTAL;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_PORTAL;
  return GOOGLE_HOST.test(url.hostname.toLowerCase()) ? GOOGLE_PORTAL : DEFAULT_PORTAL;
}
