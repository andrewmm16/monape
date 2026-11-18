import { constants as zlibConstants, inflateSync } from "node:zlib";
import { inspectDocx } from "./docx";

export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export const RESUME_MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type ResumeKind = keyof typeof RESUME_MIME_TYPES;

/** Tipos que los navegadores pueden declarar legítimamente para cada formato. */
const ACCEPTED_DECLARED_TYPES: Record<ResumeKind, string[]> = {
  pdf: ["application/pdf", "application/x-pdf", "application/octet-stream", ""],
  docx: [RESUME_MIME_TYPES.docx, "application/zip", "application/octet-stream", ""],
};

export type FileValidationResult =
  | { ok: true; kind: ResumeKind; mimeType: string; safeName: string }
  | { ok: false; reason: string };

const PDF_ACTIVE_CONTENT = /\/(?:JavaScript|JS|Launch|EmbeddedFiles?|RichMedia|XFA|SubmitForm|ImportData)(?![A-Za-z])/;

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/** Decodifica la notación #xx de nombres PDF (p. ej. /J#61vaScript). */
function decodePdfNames(text: string): string {
  return text.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 120) return cleaned || "cv";
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 ? cleaned.slice(dot) : "";
  return `${cleaned.slice(0, 120 - extension.length)}${extension}`;
}

/** Tope por object stream descomprimido y en total (un CV normal usa unos pocos KB). */
const OBJECT_STREAM_MAX_BYTES = 8 * 1024 * 1024;
const OBJECT_STREAMS_TOTAL_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Contenido de los object streams (/Type /ObjStm): desde PDF 1.5 los diccionarios
 * pueden viajar comprimidos dentro de ellos, donde un script no se ve en el texto
 * del archivo. Solo se descomprimen estos streams (no imágenes ni fuentes), con un
 * tope contra bombas de compresión. Devuelve null si alguno no se puede revisar
 * (otro filtro, datos dañados o demasiado grande).
 */
function objectStreamsText(text: string, bytes: Uint8Array): string | null {
  const parts: string[] = [];
  let total = 0;
  const streamStart = /\bstream\r?\n/g;
  for (let match = streamStart.exec(text); match; match = streamStart.exec(text)) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endstream", start);
    if (end === -1) break;
    streamStart.lastIndex = end + "endstream".length;
    // El diccionario del stream: desde el «obj» anterior hasta la palabra «stream».
    const objAt = text.lastIndexOf("obj", match.index);
    const dictionary = decodePdfNames(text.slice(objAt === -1 ? Math.max(0, match.index - 4096) : objAt, match.index));
    if (!/\/Type\s*\/ObjStm(?![A-Za-z])/.test(dictionary)) continue;

    const filterSpec = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dictionary)?.[1] ?? "";
    const filters = [...filterSpec.matchAll(/\/([A-Za-z0-9]+)/g)].map((f) => f[1]);
    const data = bytes.subarray(start, end);
    let content: Uint8Array;
    if (filters.length === 0) {
      content = data;
    } else if (filters.length === 1 && (filters[0] === "FlateDecode" || filters[0] === "Fl")) {
      try {
        // Z_SYNC_FLUSH tolera el salto de línea final antes de «endstream».
        content = inflateSync(data, { finishFlush: zlibConstants.Z_SYNC_FLUSH, maxOutputLength: OBJECT_STREAM_MAX_BYTES });
      } catch {
        return null;
      }
    } else {
      return null;
    }
    total += content.length;
    if (total > OBJECT_STREAMS_TOTAL_MAX_BYTES) return null;
    parts.push(latin1(content));
  }
  return parts.join("\n");
}

function validatePdf(bytes: Uint8Array): string | null {
  const head = latin1(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) return "El archivo no es un PDF válido.";
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 4096)));
  if (!tail.includes("%%EOF")) return "El PDF parece incompleto o dañado.";
  // Se analizan los diccionarios, no el contenido binario de los streams
  // (imágenes, fuentes), donde estas secuencias aparecen por azar. Los object
  // streams sí se abren: guardan diccionarios comprimidos.
  const text = latin1(bytes);
  const structure = text.replace(/\bstream\r?\n[\s\S]*?\bendstream\b/g, "stream endstream");
  const compressed = objectStreamsText(text, bytes);
  if (compressed === null) {
    return "El PDF tiene partes comprimidas que no se puede revisar si son seguras, así que no se acepta. Pruebe guardándolo de nuevo como PDF.";
  }
  if (PDF_ACTIVE_CONTENT.test(decodePdfNames(structure)) || PDF_ACTIVE_CONTENT.test(decodePdfNames(compressed))) {
    return "El PDF contiene contenido activo (scripts, adjuntos o acciones automáticas) y no se acepta por seguridad.";
  }
  return null;
}

/**
 * Valida extensión, tipo declarado, tamaño y contenido real (firma del
 * archivo y estructura interna). El archivo nunca se ejecuta en el servidor.
 */
export function validateResumeFile(input: {
  name: string;
  size: number;
  declaredType: string;
  bytes: Uint8Array;
}): FileValidationResult {
  if (input.size <= 0 || input.bytes.length === 0) return { ok: false, reason: "El archivo está vacío." };
  if (input.size > MAX_RESUME_BYTES || input.bytes.length > MAX_RESUME_BYTES) {
    return { ok: false, reason: "El archivo supera el tamaño máximo de 4 MB." };
  }
  if (input.bytes.length !== input.size) return { ok: false, reason: "El archivo no se recibió completo." };

  const safeName = sanitizeFileName(input.name);
  const extension = safeName.toLowerCase().split(".").pop();
  if (extension !== "pdf" && extension !== "docx") {
    return { ok: false, reason: "Solo se aceptan archivos PDF o DOCX." };
  }
  const kind: ResumeKind = extension;

  if (!ACCEPTED_DECLARED_TYPES[kind].includes(input.declaredType.toLowerCase())) {
    return { ok: false, reason: "El tipo de archivo no coincide con su extensión." };
  }

  if (kind === "pdf") {
    const problem = validatePdf(input.bytes);
    if (problem) return { ok: false, reason: problem };
  } else {
    const signature = input.bytes.subarray(0, 4);
    const isZip = signature[0] === 0x50 && signature[1] === 0x4b && signature[2] === 0x03 && signature[3] === 0x04;
    if (!isZip) return { ok: false, reason: "El archivo no es un documento DOCX válido." };
    const inspection = inspectDocx(input.bytes);
    if (!inspection.ok) return { ok: false, reason: inspection.reason };
  }

  return { ok: true, kind, mimeType: RESUME_MIME_TYPES[kind], safeName };
}
