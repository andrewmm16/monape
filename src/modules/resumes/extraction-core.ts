import { createIsomorphicCanvasFactory, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { extractHeaderFooterText, inspectDocx, repackTextParts } from "./docx.ts";
import { stripHiddenDocxText } from "./docx-hidden.ts";
import { lowContrastFlags, plausibleHiddenShare } from "./pdf-contrast.ts";
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
 * excluyeron. En PDF: fuente ~0, fuera de la hoja o sin contraste con el fondo
 * en la página renderizada (ver pdf-contrast.ts). En DOCX: texto marcado como
 * oculto, fuente ~0 o blanco sin fondo (ver docx-hidden.ts). El texto ya viene
 * limpio de esos fragmentos; `hidden` existe para avisar a RRHH.
 */
export type ExtractedParts = { text: string; hidden: HiddenFragment[] };

/** Item de texto de pdf.js que nos sirve: tiene cadena. Descarta el contenido marcado sin `str`. */
type RawTextItem = { str: string; transform: number[]; hasEOL?: boolean; width?: number; height?: number };
function isTextItem(item: unknown): item is RawTextItem {
  return typeof (item as { str?: unknown }).str === "string" && Array.isArray((item as { transform?: unknown }).transform);
}

interface RenderTask {
  promise: Promise<void>;
  cancel(): void;
}
interface TextPage {
  getTextContent(): Promise<{ items: unknown[] }>;
  getViewport(options: { scale: number }): { width: number; height: number; transform: number[] };
  render(params: { canvas: unknown; canvasContext: unknown; viewport: unknown }): RenderTask;
}
interface TextDocument {
  numPages: number;
  getPage(n: number): Promise<TextPage>;
  loadingTask: { destroy(): Promise<void> };
}

/** Lo que usamos del lienzo de @napi-rs/canvas que crea la fábrica de unpdf. */
type DrawingContext = {
  canvas: { width: number; height: number };
  context: { getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray } };
};
interface CanvasFactory {
  create(width: number, height: number): DrawingContext;
  destroy(drawing: DrawingContext): void;
}

/**
 * Detección de texto sin contraste (pdf-contrast.ts): se renderiza cada página a
 * baja resolución, con páginas y tiempo acotados. Es una señal adicional: si el
 * lienzo no está disponible, el render falla o se agota el tiempo, se omite y la
 * extracción sigue igual que siempre.
 */
const CONTRAST_MAX_PAGES = 6;
const CONTRAST_SCALE = 1.5;
const CONTRAST_MAX_SIDE_PX = 1600;
const CONTRAST_BUDGET_MS = 6000;

async function loadCanvasFactory(): Promise<CanvasFactory | null> {
  try {
    const Factory = await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas"));
    return new Factory() as unknown as CanvasFactory;
  } catch {
    return null;
  }
}

/** Renderiza la página y marca qué items no se distinguen del fondo; null si no se pudo. */
async function renderLowContrast(
  page: TextPage,
  items: RawTextItem[],
  factory: CanvasFactory,
  budgetMs: number,
): Promise<boolean[] | null> {
  const base = page.getViewport({ scale: 1 });
  const longest = Math.max(base.width, base.height);
  if (!(longest > 0)) return null;
  const viewport = page.getViewport({ scale: Math.min(CONTRAST_SCALE, CONTRAST_MAX_SIDE_PX / longest) });
  let drawing: DrawingContext | null = null;
  try {
    drawing = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const task = page.render({ canvas: drawing.canvas, canvasContext: drawing.context, viewport });
    const timer = setTimeout(() => task.cancel(), budgetMs);
    try {
      await task.promise;
    } finally {
      clearTimeout(timer);
    }
    const { width, height } = drawing.canvas;
    const raster = { width, height, data: drawing.context.getImageData(0, 0, width, height).data };
    const positioned = items.map((item) => ({ str: item.str, transform: item.transform, width: item.width ?? 0, height: item.height ?? 0 }));
    return lowContrastFlags(positioned, viewport.transform, raster);
  } catch {
    return null;
  } finally {
    if (drawing) factory.destroy(drawing);
  }
}

/**
 * Convierte las páginas del PDF en items posicionados. El tamaño de fuente y la
 * posición se derivan del `transform` del item igual que lo hace unpdf
 * (`fontSize = hypot(transform[2], transform[3])`, `x = transform[4]`,
 * `y = transform[5]`), para que el texto reensamblado coincida con el extractor
 * actual cuando no hay nada oculto. Además marca los items sin contraste con el
 * fondo en la página renderizada (`lowContrast`).
 */
async function pdfToPages(pdf: TextDocument, lowContrast: boolean): Promise<PdfPage[]> {
  const pages: PdfPage[] = [];
  let factory: CanvasFactory | null | undefined;
  // Sin detección por contraste, el plazo ya está vencido y no se renderiza nada.
  const deadline = lowContrast ? Date.now() + CONTRAST_BUDGET_MS : 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const raw = content.items.filter(isTextItem);
    const items: PdfItem[] = raw.map((item) => {
      const t = item.transform;
      return { str: item.str, x: t[4]!, y: t[5]!, fontSize: Math.hypot(t[2]!, t[3]!), hasEOL: Boolean(item.hasEOL) };
    });
    const remaining = deadline - Date.now();
    if (n <= CONTRAST_MAX_PAGES && remaining > 0 && raw.some((item) => item.str.trim() !== "")) {
      if (factory === undefined) factory = await loadCanvasFactory();
      const flags = factory ? await renderLowContrast(page, raw, factory, remaining) : null;
      flags?.forEach((low, i) => {
        if (low) items[i]!.lowContrast = true;
      });
    }
    pages.push({ items, box: { width: viewport.width, height: viewport.height } });
  }
  // Si casi todo el texto parece invisible, lo más probable es que las fuentes no
  // se hayan dibujado: no se marca nada (criterio conservador).
  if (!plausibleHiddenShare(pages.flatMap((page) => page.items))) {
    for (const page of pages) for (const item of page.items) delete item.lowContrast;
  }
  return pages;
}

async function extractPdfParts(bytes: Uint8Array, lowContrast: boolean): Promise<ExtractedParts> {
  // PDF.js 6 no evalúa código de fuentes; además se desactivan formularios XFA.
  const pdf = (await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, stopAtErrors: false })) as unknown as TextDocument;
  try {
    const pages = await pdfToPages(pdf, lowContrast);
    return assembleVisibleText(pages);
  } finally {
    // Libera memoria del documento y del worker de PDF.js.
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function extractDocxParts(bytes: Uint8Array): Promise<ExtractedParts> {
  const inspection = inspectDocx(bytes);
  if (!inspection.ok) throw new Error("docx_invalido");
  // mammoth extrae también el texto oculto: se quita del XML antes de leerlo.
  const { parts, hidden } = stripHiddenDocxText(inspection.parts);
  const sanitized = repackTextParts(parts);
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(sanitized) });
  const headerFooter = extractHeaderFooterText(parts);
  return { text: headerFooter ? `${headerFooter}\n\n${value}` : value, hidden };
}

export type ExtractOptions = {
  /**
   * Detecta el texto sin contraste renderizando las páginas del PDF (pdf-contrast.ts).
   * Activo por defecto. Quien solo necesita el texto de muchos archivos y no evalúa
   * el CV (p. ej., la lectura en lote de Caleta, que busca datos de contacto) puede
   * desactivarlo: ahorra el render de cada página.
   */
  lowContrast?: boolean;
};

/**
 * Extrae el texto y los fragmentos ocultos detectados. El texto que devuelve ya
 * está limpio de esos fragmentos, de modo que el motor evalúa solo lo visible y
 * el texto oculto no infla las coincidencias.
 */
export async function extractResumeParts(bytes: Uint8Array, kind: ResumeFileKind, options: ExtractOptions = {}): Promise<ExtractedParts> {
  return kind === "pdf" ? extractPdfParts(bytes, options.lowContrast ?? true) : extractDocxParts(bytes);
}

/** Compatibilidad: solo el texto (ya limpio de lo oculto). */
export async function extractRawText(bytes: Uint8Array, kind: ResumeFileKind, options: ExtractOptions = {}): Promise<string> {
  return (await extractResumeParts(bytes, kind, options)).text;
}
