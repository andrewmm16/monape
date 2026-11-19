/**
 * Límites y ayudas de carga de CV que también usa el navegador. No importa nada
 * del servidor (la validación de contenido vive en file-validation.ts).
 */

/** Hasta este tamaño el archivo viaja en el cuerpo de la Server Action (límite de 4,5 MB de Vercel). */
export const INLINE_RESUME_BYTES = 4 * 1024 * 1024;

/** Tamaño máximo de un CV. Los que superan INLINE_RESUME_BYTES se suben directo a Storage. */
export const MAX_RESUME_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME_BY_KIND = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type DirectResumeKind = keyof typeof MIME_BY_KIND;

export function directMimeType(kind: DirectResumeKind): string {
  return MIME_BY_KIND[kind];
}

/** Extensión admitida (solo pdf o docx) a partir del nombre, o null. */
export function resumeKindFromName(name: string): DirectResumeKind | null {
  const extension = name.split(/[\\/]/).pop()?.toLowerCase().split(".").pop();
  return extension === "pdf" || extension === "docx" ? extension : null;
}

export function maxResumeSizeMessage(limit: number): string {
  return `El archivo supera el tamaño máximo de ${Math.round(limit / (1024 * 1024))} MB.`;
}

/** `true` si el archivo no cabe en el cuerpo de una Server Action y debe ir directo a Storage. */
export function needsDirectUpload(size: number): boolean {
  return size > INLINE_RESUME_BYTES;
}

/** Destino que entrega el servidor: la URL firmada decide la ruta; el navegador no elige nada. */
export type DirectUploadTarget = { signedUrl: string; contentType: string };

/**
 * Sube el archivo a la URL firmada de carga (un solo uso). Devuelve false si
 * Storage la rechaza (vencida, usada, archivo demasiado grande, etc.).
 */
export async function putToSignedUrl(target: DirectUploadTarget, file: Blob): Promise<boolean> {
  try {
    const response = await fetch(target.signedUrl, {
      method: "PUT",
      headers: { "content-type": target.contentType, "cache-control": "max-age=0", "x-upsert": "false" },
      body: file,
      credentials: "omit",
    });
    return response.ok;
  } catch {
    return false;
  }
}
