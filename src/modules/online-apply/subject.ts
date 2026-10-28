import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * IP del cliente: primer valor de `x-forwarded-for` o, si falta, `x-real-ip`.
 * Solo es fiable detrás de un proxy que sobrescriba esos encabezados (en
 * Vercel lo hace la plataforma); si no, el cliente puede falsearla.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "";
  return ip.slice(0, 100);
}

function expandIpv6(address: string): number[] | null {
  let text = address;
  // Cola IPv4 incrustada (::ffff:1.2.3.4): se convierte en dos grupos.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    if (isIP(tail[1]!) !== 4) return null;
    const [a, b, c, d] = tail[1]!.split(".").map(Number) as [number, number, number, number];
    text = `${text.slice(0, -tail[1]!.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest, ...extra] = text.split("::");
  if (extra.length > 0) return null;
  const toGroups = (part: string | undefined) => (part ? part.split(":") : []);
  const left = toGroups(head);
  const right = rest === undefined ? [] : toGroups(rest);
  const missing = 8 - left.length - right.length;
  if ((rest === undefined && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array<string>(rest === undefined ? 0 : missing).fill("0"), ...right].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * IP canónica para el límite: quita corchetes, zona y puerto; una IPv4 mapeada en
 * IPv6 se trata como IPv4; el resto de IPv6 se agrupa por /64 (una conexión
 * doméstica o móvil recibe un prefijo /64 completo, por lo que rotar dentro de
 * él no debe dar un cupo nuevo).
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1]!;
  ip = ip.split("%")[0]!;
  const withPort = /^(\d+\.\d+\.\d+\.\d+):\d+$/.exec(ip);
  if (withPort) ip = withPort[1]!;
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return ip;

  const groups = expandIpv6(ip);
  if (!groups) return ip;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/**
 * Sujeto del límite de solicitudes: HMAC-SHA256 de la IP normalizada con
 * INTAKE_HASH_SECRET, en hexadecimal (64 caracteres). La IP en claro nunca sale
 * del servidor ni se guarda.
 *
 * Sin IP, todas las solicitudes comparten un único sujeto `sin-ip`. En
 * producción debe haber un proxy que envíe `x-forwarded-for` o `x-real-ip`: si
 * no, todo el tráfico compartiría un solo cupo por hora.
 */
export function rateLimitSubject(secret: string, headers: Pick<Headers, "get">): string {
  const raw = clientIp(headers);
  const ip = raw ? normalizeIp(raw) : "sin-ip";
  return createHmac("sha256", secret).update(`ip:${ip}`).digest("hex");
}
