import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";

/**
 * Enlace de la autoagenda: 32 bytes aleatorios en base64url. La base de datos
 * guarda solo su sha256; el enlace completo existe únicamente en el correo (o
 * en el aviso que copia RRHH).
 */
export function hashBookingToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createBookingToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashBookingToken(token) };
}

/** Token con forma válida (evita consultar la base con cualquier cosa). */
export function isBookingTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function bookingUrl(token: string): string {
  return new URL(`/agendar/${token}`, getServerEnv().APP_URL).toString();
}
