import type { IncomingMessage } from "node:http";

export const esc = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export interface UploadedFile {
  filename: string;
  bytes: Uint8Array;
}

export interface ParsedBody {
  fields: Record<string, string>;
  files: Record<string, UploadedFile>;
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function parseMultipart(body: Buffer, boundary: string): ParsedBody {
  const result: ParsedBody = { fields: {}, files: {} };
  const delimiter = Buffer.from(`--${boundary}`);
  let position = body.indexOf(delimiter);
  while (position !== -1) {
    let start = position + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    start += 2; // CRLF tras el delimitador
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const part = body.subarray(start, next - 2); // sin el CRLF previo al delimitador
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString("utf8");
      const content = part.subarray(headerEnd + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      if (name !== undefined) {
        if (filename !== undefined) {
          if (content.length > 0) result.files[name] = { filename, bytes: new Uint8Array(content) };
        } else {
          result.fields[name] = content.toString("utf8");
        }
      }
    }
    position = next;
  }
  return result;
}

/** Lee un cuerpo `application/x-www-form-urlencoded` o `multipart/form-data` (sin dependencias). */
export async function readBody(request: IncomingMessage): Promise<ParsedBody> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new Error("cuerpo demasiado grande");
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  const type = request.headers["content-type"] ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (type.toLowerCase().startsWith("multipart/form-data") && boundary) {
    return parseMultipart(body, (boundary[1] ?? boundary[2])!.trim());
  }
  return { fields: Object.fromEntries(new URLSearchParams(body.toString("utf8"))), files: {} };
}

/** PDF mínimo y válido de una página con las líneas dadas (solo ASCII; se quitan los acentos). */
export function minimalPdf(lines: string[]): Uint8Array {
  const ascii = (text: string) =>
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x20-\x7e]/g, "?")
      .replace(/[\\()]/g, "\\$&");
  const content = `BT /F1 14 Tf 72 720 Td 20 TL ${lines.map((line) => `(${ascii(line)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}
