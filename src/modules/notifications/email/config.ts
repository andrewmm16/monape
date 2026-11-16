import "server-only";
import { getServerEnv } from "@/lib/env";

export type EmailAvailability =
  | { available: true; from: string; mode: "live"; apiKey: string }
  | { available: false; reason: string };

/**
 * El correo solo se envía en modo `live` con clave y remitente configurados.
 * En modo `test` (por defecto) nunca se envía nada.
 */
export function getEmailAvailability(): EmailAvailability {
  const env = getServerEnv();
  if (env.EMAIL_DELIVERY_MODE === "test") {
    return { available: false, reason: "modo de prueba, no se envían correos" };
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { available: false, reason: "falta configurar la clave de Resend o el remitente" };
  }
  return { available: true, from: env.EMAIL_FROM, mode: "live", apiKey: env.RESEND_API_KEY };
}
