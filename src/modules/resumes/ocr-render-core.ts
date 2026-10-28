import { getDocumentProxy, renderPageAsImage } from "unpdf";

/**
 * Convierte las primeras páginas de un PDF en imágenes PNG para el OCR. Es la
 * parte que puede consumir CPU o memoria de forma desmedida con un archivo
 * hostil, por eso solo se ejecuta dentro del worker (ocr-render.worker.ts).
 * Sin `server-only`, como extraction-core.ts.
 */
export const MAX_OCR_PAGES = 4;
/** Tesseract recomienda al menos 300 dpi; un punto de PDF mide 1/72 de pulgada. */
export const OCR_DPI = 300;
/** Lado mayor máximo de la imagen, para acotar la memoria de páginas muy grandes. */
export const OCR_MAX_SIDE_PX = 3600;

/** Escala de renderizado: ≈300 dpi, sin superar `OCR_MAX_SIDE_PX` en el lado mayor. */
export function computeRenderScale(widthPt: number, heightPt: number): number {
  const target = OCR_DPI / 72;
  const longest = Math.max(widthPt, heightPt);
  if (!Number.isFinite(longest) || longest <= 0) return target;
  return Math.min(target, OCR_MAX_SIDE_PX / longest);
}

export type RenderedPages = { pages: Uint8Array[]; totalPages: number };

export async function renderPdfPages(bytes: Uint8Array, maxPages: number = MAX_OCR_PAGES): Promise<RenderedPages> {
  // Mismas opciones que la extracción: sin formularios XFA y tolerante a errores.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, stopAtErrors: false });
  try {
    const pages: Uint8Array[] = [];
    const count = Math.min(pdf.numPages, maxPages);
    for (let number = 1; number <= count; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const scale = computeRenderScale(viewport.width, viewport.height);
      const png = await renderPageAsImage(pdf, number, { scale, canvasImport: () => import("@napi-rs/canvas") });
      pages.push(new Uint8Array(png));
    }
    return { pages, totalPages: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
