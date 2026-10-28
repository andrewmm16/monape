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

export const MESSAGES = {
  unavailable: "Las postulaciones en línea no están disponibles por ahora.",
  rateLimited: "Demasiados intentos desde esta conexión. Inténtelo más tarde",
  challenge: "No se pudo verificar el envío. Inténtelo nuevamente.",
  noticeChanged: "El aviso de privacidad cambió; recargue la página",
  closed: "Esta convocatoria ya no recibe postulaciones",
  generic: "No se pudo registrar su postulación. Inténtelo nuevamente.",
  validation: "Revise los datos ingresados.",
} as const;
