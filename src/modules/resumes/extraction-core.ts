import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { extractHeaderFooterText, inspectDocx, repackTextParts } from "./docx.ts";

/**
 * Lectura de texto de PDF y DOCX. Es la parte que puede consumir CPU o memoria
 * de forma desmedida con un archivo hostil, por eso solo se ejecuta dentro del
 * worker (extraction.worker.ts). Sin `server-only`: el worker no es un módulo
 * de React. Las importaciones llevan extensión para poder cargarse también
 * directamente con Node (pruebas).
 */
export type ResumeFileKind = "pdf" | "docx";

async function extractPdf(bytes: Uint8Array): Promise<string> {
  // PDF.js 6 no evalúa código de fuentes; además se desactivan formularios XFA.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, stopAtErrors: false });
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } finally {
    // Libera memoria del documento y del worker de PDF.js.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const inspection = inspectDocx(bytes);
  if (!inspection.ok) throw new Error("docx_invalido");
  const sanitized = repackTextParts(inspection.parts);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(sanitized) });
  const headerFooter = extractHeaderFooterText(inspection.parts);
  return headerFooter ? `${headerFooter}\n\n${value}` : value;
}

export function extractRawText(bytes: Uint8Array, kind: ResumeFileKind): Promise<string> {
  return kind === "pdf" ? extractPdf(bytes) : extractDocx(bytes);
}
