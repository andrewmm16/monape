import { getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { extractHeaderFooterText, inspectDocx, repackTextParts } from "./docx.ts";
import { assembleVisibleText, type PdfItem, type PdfPage } from "./pdf-text.ts";
import type { HiddenFragment } from "./hidden-text.ts";

/**
 * Lectura de texto de PDF y DOCX. Es la parte que puede consumir CPU o memoria
 * de forma desmedida con un archivo hostil, por eso solo se ejecuta dentro del
 * worker (extraction.worker.ts). Sin `server-only`: el worker no es un módulo
 * de React. Las importaciones llevan extensión para poder cargarse también
 * directamente con Node (pruebas).
 */
export type ResumeFileKind = "pdf" | "docx";

/**
 * Texto del documento más los fragmentos OCULTOS que se detectaron y se
 * excluyeron (texto no visible: fuente ~0 o fuera de la hoja). El texto ya
 * viene limpio de esos fragmentos; `hidden` existe para avisar a RRHH. En DOCX
 * no hay posición ni tamaño de fuente fiables, así que `hidden` va vacío.
 */
export type ExtractedParts = { text: string; hidden: HiddenFragment[] };

/** Item de texto de pdf.js que nos sirve: tiene cadena. Descarta el contenido marcado sin `str`. */
type RawTextItem = { str: string; transform: number[]; hasEOL?: boolean };
function isTextItem(item: unknown): item is RawTextItem {
  return typeof (item as { str?: unknown }).str === "string" && Array.isArray((item as { transform?: unknown }).transform);
}

interface TextPage {
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(options: { scale: number }): { width: number; height: number };
}
interface TextDocument {
  numPages: number;
  getPage(n: number): Promise<TextPage>;
  loadingTask: { destroy(): Promise<void> };
}

/**
 * Convierte las páginas del PDF en items posicionados. El tamaño de fuente y la
 * posición se derivan del `transform` del item igual que lo hace unpdf
 * (`fontSize = hypot(transform[2], transform[3])`, `x = transform[4]`,
 * `y = transform[5]`), para que el texto reensamblado coincida con el extractor
 * actual cuando no hay nada oculto.
 */
async function pdfToPages(pdf: TextDocument): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items: PdfItem[] = content.items.filter(isTextItem).map((item) => {
      const t = item.transform;
      return { str: item.str, x: t[4]!, y: t[5]!, fontSize: Math.hypot(t[2]!, t[3]!), hasEOL: Boolean(item.hasEOL) };
    });
    pages.push({ items, box: { width: viewport.width, height: viewport.height } });
  }
  return pages;
}

async function extractPdfParts(bytes: Uint8Array): Promise<ExtractedParts> {
  // PDF.js 6 no evalúa código de fuentes; además se desactivan formularios XFA.
  const pdf = (await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, stopAtErrors: false })) as unknown as TextDocument;
  try {
    const pages = await pdfToPages(pdf);
    return assembleVisibleText(pages);
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

/**
 * Extrae el texto y, en PDF, los fragmentos ocultos detectados. El texto que
 * devuelve ya está limpio de esos fragmentos, de modo que el motor evalúa solo
 * lo visible y el texto oculto no infla las coincidencias.
 */
export async function extractResumeParts(bytes: Uint8Array, kind: ResumeFileKind): Promise<ExtractedParts> {
  if (kind === "pdf") return extractPdfParts(bytes);
  return { text: await extractDocx(bytes), hidden: [] };
}

/** Compatibilidad: solo el texto (ya limpio de lo oculto en PDF). */
export async function extractRawText(bytes: Uint8Array, kind: ResumeFileKind): Promise<string> {
  return (await extractResumeParts(bytes, kind)).text;
}
