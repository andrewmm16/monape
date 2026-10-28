import { MAX_RESUME_BYTES, sanitizeFileName, validateResumeFile, type ResumeKind } from "@/modules/resumes/file-validation";

/** Códigos de rechazo: se guardan como `reason` (nunca datos personales). */
export type ResumeRejection = "cv_base64_invalido" | "cv_vacio" | "cv_demasiado_grande" | "cv_invalido";

export type DecodedResume = { ok: true; bytes: Uint8Array } | { ok: false; reason: ResumeRejection };

const DATA_URL_PREFIX = /^data:[^,]*;base64,/i;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodifica el CV recibido: base64 normal o con prefijo `data:...;base64,`.
 * El tamaño decodificado se calcula ANTES de reservar memoria.
 */
export function decodeResumeData(data: string): DecodedResume {
  const compact = data.replace(DATA_URL_PREFIX, "").replace(/\s+/g, "");
  if (!BASE64_BODY.test(compact) || compact.length % 4 === 1) return { ok: false, reason: "cv_base64_invalido" };
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  if (padding > 0 && compact.length % 4 !== 0) return { ok: false, reason: "cv_base64_invalido" };
  const size = Math.floor((compact.length * 3) / 4) - padding;
  if (size <= 0) return { ok: false, reason: "cv_vacio" };
  if (size > MAX_RESUME_BYTES) return { ok: false, reason: "cv_demasiado_grande" };
  return { ok: true, bytes: new Uint8Array(Buffer.from(compact, "base64")) };
}

/** Formato por contenido (firma del archivo), nunca por `contentType` ni por la extensión. */
export function sniffResumeKind(bytes: Uint8Array): ResumeKind | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  return isZip ? "docx" : null;
}

export type ValidatedResume =
  | { ok: true; bytes: Uint8Array; kind: ResumeKind; mimeType: string; filename: string }
  | { ok: false; reason: ResumeRejection };

/**
 * Decodifica y valida el CV con los mismos validadores de la subida habitual
 * (PDF sin contenido activo, DOCX sin macros ni partes externas, 4 MB).
 */
export function validateIncomingResume(file: { fileName?: string; data: string }): ValidatedResume {
  const decoded = decodeResumeData(file.data);
  if (!decoded.ok) return decoded;

  const kind = sniffResumeKind(decoded.bytes);
  if (!kind) return { ok: false, reason: "cv_invalido" };

  // El nombre y el tipo declarados no cuentan: se valida con un nombre derivado del contenido.
  const validation = validateResumeFile({
    name: `cv.${kind}`,
    size: decoded.bytes.length,
    declaredType: "",
    bytes: decoded.bytes,
  });
  if (!validation.ok) return { ok: false, reason: "cv_invalido" };

  // Nombre para mostrar: el recibido, con la extensión que corresponde al contenido.
  const safe = sanitizeFileName(file.fileName ?? "cv");
  const filename = safe.toLowerCase().endsWith(`.${kind}`) ? safe : `${safe}.${kind}`;
  return { ok: true, bytes: decoded.bytes, kind, mimeType: validation.mimeType, filename };
}
