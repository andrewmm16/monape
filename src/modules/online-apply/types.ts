/** Resultado de la Server Action de postulación (serializable). */
export type SubmitApplicationResult =
  | { ok: true; reference: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
      /** El desafío ya no sirve: el navegador debe pedir y resolver otro antes de reintentar. */
      refreshChallenge?: boolean;
      /** El aviso de privacidad cambió: hay que recargar la página. */
      reload?: boolean;
    };

/**
 * Primer paso de la carga directa (CV de más de 4 MB): la URL firmada y el
 * comprobante que el navegador devuelve al confirmar. `decoy` es el campo trampa:
 * no hay nada que subir y la confirmación responde con éxito ficticio.
 */
export type RequestApplicationUploadResult =
  | { ok: true; decoy: true }
  | { ok: true; decoy?: false; ticket: string; signedUrl: string; contentType: string }
  | Extract<SubmitApplicationResult, { ok: false }>;

export const MESSAGES = {
  unavailable: "Las postulaciones en línea no están disponibles por ahora.",
  rateLimited: "Demasiados intentos desde esta conexión. Inténtelo más tarde",
  challenge: "No se pudo verificar el envío. Inténtelo nuevamente.",
  noticeChanged: "El aviso de privacidad cambió; recargue la página",
  closed: "Esta convocatoria ya no recibe postulaciones",
  generic: "No se pudo registrar su postulación. Inténtelo nuevamente.",
  validation: "Revise los datos ingresados.",
} as const;
