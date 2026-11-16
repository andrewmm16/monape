/**
 * Verificación de entregabilidad de correos del Reclutador Caleta.
 *
 * Alcance deliberado: comprueba un correo que la persona **aporta** (al postular,
 * al responder el primer contacto o al dejarlo en una fuente propia). NO genera,
 * permuta ni adivina direcciones, y NO rastrea internet: recibe un correo ya
 * conocido y solo responde si el dominio puede recibir mensajes, para no enviar
 * a un buzón que rebotará. Coherente con `lector-cv-lote.ts` y `outreach.ts`
 * (nada de datos de terceros).
 */

import { resolveMx } from "node:dns/promises";

/** Resultado de la comprobación de un correo aportado. */
export type EmailDomainStatus =
  | "entregable" // el dominio tiene servidores de correo (MX) válidos
  | "sin-mx" // el dominio existe pero no acepta correo, o no existe
  | "sintaxis-invalida" // no es un correo bien formado
  | "error-dns"; // fallo transitorio de DNS (timeout, servfail): reintentar

export interface EmailVerificationResult {
  /** El valor original recibido, sin modificar. */
  readonly input: string;
  /** El correo normalizado (minúsculas, sin espacios) o `null` si no es válido. */
  readonly normalized: string | null;
  readonly status: EmailDomainStatus;
  /** Hosts MX ordenados por prioridad (vacío salvo que el estado sea `entregable`). */
  readonly mxHosts: readonly string[];
}

/**
 * Resolviente de registros MX. Por defecto usa `node:dns/promises`; se inyecta
 * en las pruebas para no depender de la red.
 */
export type MxResolver = (
  domain: string,
) => Promise<Array<{ exchange: string; priority: number }>>;

// Validación de forma pragmática: un @, algo antes, y un dominio con punto.
// No pretende cubrir el RFC 5322 completo; descarta los casos obvios antes del DNS.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normaliza un correo (recorta y pasa a minúsculas) o devuelve `null` si no es válido. */
export function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

/**
 * Verifica que un correo aportado tenga sintaxis válida y un dominio que acepte
 * correo (registros MX). No contacta al buzón ni confirma que la persona exista;
 * solo evita rebotes por dominio muerto antes de un envío legítimo.
 */
export async function verifyProvidedEmail(
  raw: string,
  resolver: MxResolver = resolveMx,
): Promise<EmailVerificationResult> {
  const normalized = normalizeEmail(raw);
  if (normalized === null) {
    return { input: raw, normalized: null, status: "sintaxis-invalida", mxHosts: [] };
  }

  try {
    const records = await resolver(domainOf(normalized));
    const mxHosts = records
      .filter((r) => r.exchange.length > 0)
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);

    return mxHosts.length > 0
      ? { input: raw, normalized, status: "entregable", mxHosts }
      : { input: raw, normalized, status: "sin-mx", mxHosts: [] };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    // El dominio no existe o no tiene MX: es un veredicto, no un fallo transitorio.
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { input: raw, normalized, status: "sin-mx", mxHosts: [] };
    }
    return { input: raw, normalized, status: "error-dns", mxHosts: [] };
  }
}
