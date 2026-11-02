import type { ParsedMail } from "../parse";

export interface ExtractedApplicant {
  /** Id de la oferta en el portal (el mismo que la app guarda como `externalId` de la publicación). */
  offerRef: string;
  fullName: string;
  email?: string;
  phone?: string;
}

/**
 * Lo único que cambia de un portal a otro. Solo lee el correo ya verificado;
 * nunca habla con la app ni con la red.
 */
export interface PortalTemplate {
  /** Nombre corto del portal en la API del robot, por ejemplo "trabajos-diarios". */
  readonly portal: string;
  /** Dominios desde los que el portal envía (en minúsculas; se aceptan sus subdominios). */
  readonly senderDomains: readonly string[];
  /** ¿Es un aviso de postulación de este portal? (por ejemplo, por el asunto) */
  matches(mail: ParsedMail): boolean;
  /** Datos del postulante, o `null` si el correo no tiene el formato esperado. */
  extract(mail: ParsedMail): ExtractedApplicant | null;
}
