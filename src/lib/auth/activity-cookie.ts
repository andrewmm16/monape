import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { ACTIVITY_COOKIE, ACTIVITY_COOKIE_OPTIONS } from "./inactivity";

/**
 * Cookie de última actividad: `<hora>.<firma>`. La firma (HMAC con la clave
 * secreta del servidor) liga la hora al usuario: no puede editarse desde el
 * navegador para reabrir una sesión vencida ni copiarse de otra cuenta.
 */
function sign(userId: string, time: string): string {
  const secret = getServerEnv().SUPABASE_SECRET_KEY;
  if (!secret) throw new AppError("Falta configurar la clave de servicio de Supabase en el servidor.", "unavailable");
  return createHmac("sha256", secret).update(`${ACTIVITY_COOKIE}:${userId}:${time}`).digest("base64url");
}

export function createActivityCookieValue(userId: string, now = Date.now()): string {
  const time = String(now);
  return `${time}.${sign(userId, time)}`;
}

/** Hora de la última actividad si la cookie es auténtica y de este usuario; si no, `null`. */
export function readActivityTime(value: string | undefined, userId: string): number | null {
  const match = value?.match(/^(\d{1,15})\.([\w-]{43})$/);
  if (!match) return null;
  const time = match[1]!;
  const signature = match[2]!;
  let expected: string;
  try {
    expected = sign(userId, time);
  } catch {
    return null;
  }
  const received = Buffer.from(signature);
  return timingSafeEqual(received, Buffer.from(expected)) ? Number(time) : null;
}

/** Registra actividad ahora. Solo en Server Actions y Route Handlers. */
export async function touchActivityCookie(userId: string): Promise<void> {
  (await cookies()).set(ACTIVITY_COOKIE, createActivityCookieValue(userId), ACTIVITY_COOKIE_OPTIONS);
}
