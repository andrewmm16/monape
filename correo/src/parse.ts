import { simpleParser } from "mailparser";

export interface MailAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ParsedMail {
  /** Identificador del correo (sin los <>); si falta, vacío: el correo se rechaza al procesarlo. */
  messageId: string;
  /** Dominio del remitente en minúsculas; vacío si no se pudo leer. */
  fromDomain: string;
  subject: string;
  text: string;
  attachments: MailAttachment[];
  /** Valores del encabezado Authentication-Results (puede haber varios); vacío si no existe. */
  authResults: string[];
}

function headerValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

export async function parseEmail(raw: Buffer): Promise<ParsedMail> {
  const mail = await simpleParser(raw);
  const address = mail.from?.value[0]?.address ?? "";
  const at = address.lastIndexOf("@");
  return {
    messageId: (mail.messageId ?? "").replace(/^<|>$/g, "").trim(),
    fromDomain: at >= 0 ? address.slice(at + 1).trim().toLowerCase() : "",
    subject: mail.subject ?? "",
    text: mail.text ?? "",
    attachments: mail.attachments
      .filter((item) => item.contentDisposition !== "inline" || item.filename)
      .map((item) => ({
        filename: item.filename ?? "adjunto",
        contentType: (item.contentType ?? "").toLowerCase(),
        bytes: new Uint8Array(item.content),
      })),
    authResults: headerValues(mail.headers.get("authentication-results")),
  };
}
