/**
 * Cierre de sesión por inactividad (30 minutos).
 *
 * - El navegador (InactivityGuard) detecta la actividad del usuario, muestra el
 *   aviso «¿Sigue ahí?» durante el último minuto y cierra la sesión al vencer.
 * - Mientras hay actividad, la informa al servidor como máximo una vez por
 *   minuto; el servidor guarda su propia hora en una cookie `httpOnly` firmada
 *   (ver activity-cookie.ts).
 * - El proxy cierra la sesión si esa hora es demasiado antigua o no es válida.
 *   Cubre la pestaña cerrada, el equipo apagado y el navegador sin JavaScript.
 *
 * No depende del servidor: lo usan el proxy, las rutas y el cliente.
 */

export const IDLE_TIMEOUT_MS = 30 * 60_000;
export const IDLE_WARNING_MS = 60_000;
export const ACTIVITY_REPORT_INTERVAL_MS = 60_000;

/**
 * El servidor conoce la actividad con hasta un intervalo de retraso; el margen
 * evita que cierre la sesión antes que el aviso del navegador.
 */
export const SERVER_IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MS + 2 * ACTIVITY_REPORT_INTERVAL_MS;

export const ACTIVITY_COOKIE = "ultima-actividad";
export const ACTIVITY_COOKIE_OPTIONS = { path: "/", sameSite: "lax", httpOnly: true, maxAge: 24 * 60 * 60 } as const;
export const ACTIVITY_ENDPOINT = "/api/sesion/actividad";
export const IDLE_SIGN_OUT_PATH = "/auth/inactividad";

/** Tolerancia ante relojes ligeramente distintos entre instancias del servidor. */
const CLOCK_TOLERANCE_MS = 60_000;

/** Milisegundos desde la última actividad registrada por el servidor; `null` si no hay una hora válida. */
export function serverIdleMs(lastActivity: number | null, now = Date.now()): number | null {
  if (lastActivity === null) return null;
  const idle = now - lastActivity;
  // El servidor nunca registra una hora futura: se trata como no válida.
  if (idle < -CLOCK_TOLERANCE_MS) return null;
  return Math.max(0, idle);
}

/** Sin una hora válida, la sesión se da por vencida (falla de forma segura). */
export function isServerIdleExpired(lastActivity: number | null, now = Date.now()): boolean {
  const idle = serverIdleMs(lastActivity, now);
  return idle === null || idle > SERVER_IDLE_TIMEOUT_MS;
}
