import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Longitud del token por vacante (base64url recortado). */
export const TALENT_TOKEN_LENGTH = 32;

/**
 * Token de la URL de postulación de una vacante:
 * HMAC-SHA256(secreto, "talent-apply:" + código) en base64url, 32 caracteres.
 * Talent.com no documenta firma ni cabeceras de autenticación, por lo que esta
 * es la única barrera de la ruta.
 */
export function talentApplyToken(secret: string, vacancyCode: string): string {
  return createHmac("sha256", secret).update(`talent-apply:${vacancyCode}`).digest("base64url").slice(0, TALENT_TOKEN_LENGTH);
}

/** Comparación en tiempo constante (también oculta la longitud de los valores). */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function isValidApplyToken(secret: string, vacancyCode: string, token: string): boolean {
  return safeEqual(talentApplyToken(secret, vacancyCode), token);
}

export function isValidFeedToken(expected: string, token: string): boolean {
  return safeEqual(expected, token);
}

/** Ruta (sin origen) a la que Talent.com envía las postulaciones de una vacante. */
export function talentApplyPostPath(vacancyCode: string, token: string): string {
  return `/api/integraciones/talent/postular/${vacancyCode}/${token}`;
}
