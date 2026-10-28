import { parentPort, workerData } from "node:worker_threads";
import { renderPdfPages } from "./ocr-render-core.ts";

/**
 * Entrada del worker de renderizado para OCR. Recibe `{ bytes }`, responde con
 * `{ ok: true, pages, totalPages }` (PNG transferidos, sin copia) o `{ ok: false }`
 * y termina. Si agota la memoria o el plazo, quien lo lanzó lo termina
 * (ver ocr-render-runner.ts).
 */
async function main() {
  const { bytes } = workerData as { bytes: Uint8Array };
  try {
    const { pages, totalPages } = await renderPdfPages(bytes);
    parentPort?.postMessage(
      { ok: true, pages, totalPages },
      pages.map((page) => page.buffer as ArrayBuffer),
    );
  } catch (error) {
    parentPort?.postMessage({ ok: false, exhausted: error instanceof RangeError });
  }
}

void main();
