import { createHash } from "node:crypto";
import type { BotApiLike } from "../../bot/src/api";
import { parseEmail, type ParsedMail } from "./parse";
import type { MailSourceLike } from "./sources";
import type { StateStore } from "./state";
import type { PortalTemplate } from "./templates";

/** Mismo límite que valida la app para un CV. */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export type MailResult =
  | "registrada"
  | "ya_registrada"
  | "sin_cv"
  | "remitente_no_autorizado"
  | "sin_plantilla"
  | "oferta_desconocida"
  | "cv_invalido"
  | "error";

/** Solo `error` se reintenta en la pasada siguiente; el resto es definitivo y queda en el estado. */
const RETRIABLE: ReadonlySet<MailResult> = new Set(["error"]);

export type Logger = (message: string) => void;

export interface ProcessDeps {
  api: BotApiLike;
  templates: readonly PortalTemplate[];
  state: StateStore;
  requireAuth: boolean;
  log: Logger;
}

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/**
 * Regla de autenticidad. Se mira SOLO el primer Authentication-Results (el más
 * reciente, añadido por NUESTRO servidor de correo; los demás pueden venir del
 * remitente y no valen). Se acepta si en ese encabezado consta `dmarc=pass` y además
 * `dkim=pass` o `spf=pass`. Si el encabezado falta, se rechaza.
 */
export function isAuthentic(authResults: readonly string[]): boolean {
  const header = authResults[0];
  if (!header) return false;
  const passes = (method: string) => new RegExp(`(^|[\\s;(])${method}=pass(?![\\w-])`, "i").test(header);
  return passes("dmarc") && (passes("dkim") || passes("spf"));
}

/** El dominio del remitente es el de la plantilla o un subdominio suyo. */
function domainMatches(fromDomain: string, template: PortalTemplate): boolean {
  return template.senderDomains.some((domain) => fromDomain === domain || fromDomain.endsWith(`.${domain}`));
}

/** Un posible CV: PDF o DOCX por tipo declarado o extensión (el servidor vuelve a validar el contenido). */
function isResumeType(contentType: string, filename: string): boolean {
  const name = filename.toLowerCase();
  return (
    contentType === "application/pdf" ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx")
  );
}

/** `null` = no hay adjuntos que cuenten; `undefined` = los hay pero ninguno sirve. Las imágenes (firmas, logos) no cuentan. */
function pickResume(mail: ParsedMail): { filename: string; bytes: Uint8Array } | null | undefined {
  const candidates = mail.attachments.filter((item) => !item.contentType.startsWith("image/"));
  if (candidates.length === 0) return null;
  const valid = candidates.find(
    (item) => isResumeType(item.contentType, item.filename) && item.bytes.length > 0 && item.bytes.length <= MAX_RESUME_BYTES,
  );
  return valid ? { filename: valid.filename, bytes: valid.bytes } : undefined;
}

/** Identificador del correo para el estado: su Message-ID o, si no lo trae, el hash de su contenido. */
function mailKey(mail: ParsedMail, raw: Buffer): string {
  return mail.messageId || `contenido:${sha256(raw)}`;
}

/**
 * Atiende un correo, guarda su resultado en el estado (salvo `error`, que se reintenta)
 * y devuelve solo el código y un hash corto. No registra nada de su contenido.
 * `omitido` = ya estaba en el estado: no se vuelve a enviar.
 */
export async function processMail(raw: Buffer, deps: ProcessDeps): Promise<{ result: MailResult | "omitido"; hash: string }> {
  let full = sha256(raw);
  try {
    const mail = await parseEmail(raw);
    full = sha256(mailKey(mail, raw));
    if (deps.state.has(full)) return { result: "omitido", hash: full.slice(0, 8) };
    const result = await decide(mail, full, deps);
    if (!RETRIABLE.has(result)) deps.state.add(full, result);
    return { result, hash: full.slice(0, 8) };
  } catch {
    return { result: "error", hash: full.slice(0, 8) };
  }
}

async function decide(mail: ParsedMail, hash: string, deps: ProcessDeps): Promise<MailResult> {
  // (a) Remitente: el dominio debe ser de un portal conocido y el correo, auténtico.
  const sameDomain = deps.templates.filter((template) => domainMatches(mail.fromDomain, template));
  if (sameDomain.length === 0) return "remitente_no_autorizado";
  if (deps.requireAuth && !isAuthentic(mail.authResults)) return "remitente_no_autorizado";

  // (b) Plantilla y datos del postulante.
  const template = sameDomain.find((item) => item.matches(mail));
  const applicant = template?.extract(mail) ?? null;
  if (!template || !applicant) return "sin_plantilla";

  // (c) Publicación a la que corresponde.
  const publication = (await deps.api.active(template.portal)).find((item) => item.externalId === applicant.offerRef);
  if (!publication) return "oferta_desconocida";

  // (d) CV. Sin adjunto no se envía nada: queda registrado para que RRHH o el robot lo atiendan.
  const resume = pickResume(mail);
  if (resume === null) return "sin_cv";
  if (resume === undefined) return "cv_invalido";

  // (e) Entrega. El id externo es un hash del Message-ID: estable y sin datos personales.
  const status = await deps.api.sendApplicant(
    publication.publicationId,
    {
      externalId: `correo-${hash}`,
      fullName: applicant.fullName,
      email: applicant.email,
      phone: applicant.phone,
      resumeRef: "",
    },
    resume,
  );
  if (status === "registrada" || status === "ya_registrada") return status;
  // «cerrada»: la vacante ya no recibe postulantes. «invalida»: la app rechazó el CV.
  return status === "cerrada" ? "oferta_desconocida" : "cv_invalido";
}

/**
 * Una pasada por la fuente. Un correo malo nunca detiene a los demás.
 * Devuelve cuántos correos dieron cada resultado.
 */
export async function runPass(source: MailSourceLike, deps: ProcessDeps): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const count = (code: string) => {
    counts[code] = (counts[code] ?? 0) + 1;
  };
  const known = (messageId: string) => deps.state.has(sha256(messageId));
  for await (const { raw } of source.fetchNew(known)) {
    const { result, hash } = await processMail(raw, deps);
    if (result === "omitido") continue;
    count(result);
    deps.log(`correo ${hash}: ${result}`);
  }
  return counts;
}
