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

function validatePdf(bytes: Uint8Array): string | null {
  const head = latin1(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) return "El archivo no es un PDF válido.";
  const tail = latin1(bytes.subarray(Math.max(0, bytes.length - 4096)));
  if (!tail.includes("%%EOF")) return "El PDF parece incompleto o dañado.";
  // Se analizan los diccionarios, no el contenido binario de los streams
  // (imágenes, fuentes), donde estas secuencias aparecen por azar.
  const structure = latin1(bytes).replace(/\bstream\r?\n[\s\S]*?\bendstream\b/g, "stream endstream");
  if (PDF_ACTIVE_CONTENT.test(decodePdfNames(structure))) {
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
