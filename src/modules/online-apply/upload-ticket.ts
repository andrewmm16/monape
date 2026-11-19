import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { resumeStoragePath } from "@/modules/intake/paths";
import type { DirectResumeKind } from "@/modules/resumes/upload-limits";

/**
 * Comprobante de la carga directa del formulario público. Lo emite el servidor
 * después de verificar la prueba de trabajo y los límites, y liga la vacante, la
 * ruta del archivo (por sus identificadores) y un vencimiento con una firma
 * HMAC. Al confirmar, la ruta se reconstruye desde el comprobante: el navegador
 * nunca la envía. No contiene datos personales.
 */

/** Tiempo que tiene el navegador para subir el archivo y confirmar. */
export const UPLOAD_TICKET_TTL_MS = 10 * 60 * 1000;

const VACANCY_CODE = /^[a-z0-9]{10}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type UploadTicket = {
  vacancyCode: string;
  candidateId: string;
  resumeId: string;
  kind: DirectResumeKind;
  expiresAt: number;
};

function signature(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(`cv-upload-ticket:v1:${body}`).digest();
}

export function signUploadTicket(secret: string, ticket: UploadTicket): string {
  const body = [ticket.vacancyCode, ticket.candidateId, ticket.resumeId, ticket.kind, String(ticket.expiresAt)].join(".");
  return `${body}.${signature(secret, body).toString("base64url")}`;
}

/** El comprobante si la firma, el formato y la vigencia son correctos; si no, null. */
export function verifyUploadTicket(secret: string, value: string, now = Date.now()): UploadTicket | null {
  if (value.length > 300) return null;
  const parts = value.split(".");
  if (parts.length !== 6) return null;
  const [vacancyCode, candidateId, resumeId, kind, expires, mac] = parts as [string, string, string, string, string, string];
  if (!VACANCY_CODE.test(vacancyCode) || !UUID.test(candidateId) || !UUID.test(resumeId)) return null;
  if (kind !== "pdf" && kind !== "docx") return null;
  if (!/^\d{10,16}$/.test(expires)) return null;

  const expected = signature(secret, parts.slice(0, 5).join("."));
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now) return null;
  return { vacancyCode, candidateId, resumeId, kind, expiresAt };
}

/** Ruta del objeto que corresponde al comprobante. */
export function ticketStoragePath(ticket: UploadTicket): string {
  return resumeStoragePath(ticket.candidateId, ticket.resumeId, ticket.kind);
}
