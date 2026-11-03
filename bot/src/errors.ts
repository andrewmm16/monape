/**
 * Códigos que la app sabe mostrar a RRHH (ver `PORTAL_ERROR_LABELS` en
 * `src/lib/labels.ts`). Deben cumplir /^[a-z0-9_]{1,64}$/.
 */
export const ERROR_CODES = {
  sessionExpired: "sesion_expirada",
  verificationRequired: "verificacion_requerida",
  pageChanged: "pagina_cambio",
  publicationRejected: "publicacion_rechazada",
  /** El navegador del robot se cerró (ventana cerrada o caída): no es un cambio del portal. */
  browserClosed: "navegador_cerrado",
  /** El portal no responde (caído, sin internet, DNS): no es un cambio de su página. */
  portalUnreachable: "portal_no_disponible",
  /** La app (no el portal) no respondió o falló. */
  appUnavailable: "api_no_disponible",
  /** La app no aceptó el resultado de un trabajo (por ejemplo, la publicación cambió de estado). */
  resultRejected: "resultado_rechazado",
  /** Retiro pedido sin conocer el id de la oferta (se cerró la vacante mientras se publicaba). */
  withdrawWithoutId: "retiro_sin_id",
  /** La oferta ya no existe en el portal (vencida, borrada o retirada a mano): no es un cambio de su página. */
  offerNotFound: "oferta_no_encontrada",
  /** No se pudieron traer todos los postulantes antes de retirar la oferta: se reintenta para no perderlos. */
  finalSyncIncomplete: "sincronizacion_pendiente",
  /** Varios trabajos seguidos fallaron en un portal: el robot lo detiene para no vaciar la cola. */
  consecutiveFailures: "fallos_seguidos",
} as const;

/**
 * Errores que exigen a una persona: el robot se detiene y no lo reintenta.
 * Nunca se intenta resolver un CAPTCHA ni un código de verificación.
 */
export const HUMAN_REQUIRED = new Set<string>([
  ERROR_CODES.sessionExpired,
  ERROR_CODES.verificationRequired,
  ERROR_CODES.browserClosed,
]);

/** Mensaje de Playwright cuando no se pudo llegar al servidor del portal (red, DNS, conexión rechazada o cortada). */
const UNREACHABLE = /net::ERR_(?:CONNECTION_(?:REFUSED|RESET|CLOSED|TIMED_OUT)|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|TIMED_OUT)/;

/** Mensaje de Playwright cuando la página, el contexto o el navegador ya no existen. */
const BROWSER_CLOSED = /(?:page|context|browser) has been closed|browser has disconnected/i;

/**
 * Fallos que NO se arreglan cambiando el adaptador (los resuelve una persona o es
 * la app): no se ofrecen como reparables en los incidentes.
 */
export const NOT_REPAIRABLE = new Set<string>([
  ...HUMAN_REQUIRED,
  ERROR_CODES.portalUnreachable,
  ERROR_CODES.appUnavailable,
  ERROR_CODES.resultRejected,
  ERROR_CODES.withdrawWithoutId,
  ERROR_CODES.offerNotFound,
  ERROR_CODES.finalSyncIncomplete,
]);

/** La app respondió con un estado de error (distinto de un fallo con el portal). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`La app respondió ${status} en ${path}`);
    this.name = "ApiError";
  }
}

export class PortalError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PortalError";
  }
}

/** Código a reportar para cualquier error. Lo inesperado (p. ej. un tiempo agotado) se trata como cambio de página. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof ApiError) return ERROR_CODES.appUnavailable;
  if (error instanceof PortalError) return error.code;
  if (error instanceof Error && BROWSER_CLOSED.test(error.message)) return ERROR_CODES.browserClosed;
  if (error instanceof Error && UNREACHABLE.test(error.message)) return ERROR_CODES.portalUnreachable;
  return ERROR_CODES.pageChanged;
}
