import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { leadingZeroBits, POW_BITS } from "./pow";

/**
 * Desafío firmado de la prueba de trabajo. Formato (sin estado en el servidor):
 *   v1.<vacante>.<emisión en ms>.<nonce>.<bits>.<firma>
 * La firma es HMAC-SHA256(INTAKE_HASH_SECRET, todo lo anterior). El uso único
 * lo garantiza consume_form_challenge con el SHA-256 del desafío completo.
 */
export const CHALLENGE_MAX_AGE_MS = 30 * 60 * 1000;
export const CHALLENGE_MIN_AGE_MS = 3000;

const VACANCY_CODE = /^[a-z0-9]{10}$/;
const PREFIX = "v1";

export type IssuedChallenge = { challenge: string; bits: number };

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(`challenge:${payload}`).digest("base64url");
}

export function isVacancyCode(value: string): boolean {
  return VACANCY_CODE.test(value);
}

export function issueChallenge(secret: string, vacancyCode: string, now: number = Date.now()): IssuedChallenge {
  const payload = [PREFIX, vacancyCode, String(now), randomBytes(16).toString("base64url"), String(POW_BITS)].join(".");
  return { challenge: `${payload}.${sign(secret, payload)}`, bits: POW_BITS };
}

export type ChallengeFailure = "formato" | "firma" | "vacante" | "vencido" | "demasiado_reciente" | "solucion";

export type ChallengeCheck = { ok: true; hash: string } | { ok: false; reason: ChallengeFailure };

/** Hash hexadecimal (64 caracteres) del desafío: es lo único que se guarda como usado. */
export function challengeHash(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex");
}

/**
 * Verifica firma, vacante, antigüedad (entre 3 segundos y 30 minutos) y los
 * bits en cero de SHA-256(desafío + ":" + solución). No consume el desafío.
 */
export function verifyChallenge(
  secret: string,
  vacancyCode: string,
  challenge: string,
  solution: string,
  now: number = Date.now(),
): ChallengeCheck {
  if (challenge.length > 300 || solution.length > 64) return { ok: false, reason: "formato" };
  const parts = challenge.split(".");
  if (parts.length !== 6 || parts[0] !== PREFIX) return { ok: false, reason: "formato" };
  const [, code, issuedRaw, nonce, bitsRaw, signature] = parts as [string, string, string, string, string, string];
  if (!VACANCY_CODE.test(code) || !/^\d{10,16}$/.test(issuedRaw) || !/^\d{1,2}$/.test(bitsRaw) || !nonce || !signature) {
    return { ok: false, reason: "formato" };
  }

  const expected = Buffer.from(sign(secret, parts.slice(0, 5).join(".")));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: "firma" };

  if (code !== vacancyCode) return { ok: false, reason: "vacante" };

  const age = now - Number(issuedRaw);
  if (age > CHALLENGE_MAX_AGE_MS) return { ok: false, reason: "vencido" };
  if (age < CHALLENGE_MIN_AGE_MS) return { ok: false, reason: "demasiado_reciente" };

  // Nunca se acepta menos dificultad que la vigente, aunque la firma sea válida.
  const bits = Number(bitsRaw);
  if (bits < POW_BITS) return { ok: false, reason: "solucion" };
  const digest = createHash("sha256").update(`${challenge}:${solution}`).digest();
  if (leadingZeroBits(digest) < bits) return { ok: false, reason: "solucion" };

  return { ok: true, hash: challengeHash(challenge) };
}
