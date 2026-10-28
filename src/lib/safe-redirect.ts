const ALLOWED_PREFIXES = ["/panel", "/vacantes", "/candidatos", "/postulaciones", "/usuarios", "/restablecer"];

/**
 * Devuelve una ruta interna segura para redirigir tras iniciar sesión o
 * confirmar un enlace. Evita redirecciones abiertas a dominios externos.
 */
export function safeNextPath(value: unknown, fallback = "/panel"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, "http://interno.local");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://interno.local") return fallback;

  const path = url.pathname;
  const allowed = ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return allowed ? `${path}${url.search}` : fallback;
}
