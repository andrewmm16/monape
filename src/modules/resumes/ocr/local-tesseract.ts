import "server-only";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logServerError } from "@/lib/errors";
import { Semaphore } from "../extraction-runner";
import { renderPagesInWorker } from "../ocr-render-runner";
import {
  OCR_LOCAL_EXTRACTOR_VERSION,
  type OcrEngine,
  type OcrEngineResult,
  type OcrRecognizeOptions,
} from "./types";

/** Plazo total del reconocimiento (todas las páginas), aparte del renderizado. */
export const OCR_RECOGNIZE_TIMEOUT_MS = 90_000;
/** Espera máxima en cola para el único permiso de OCR del proceso. */
export const OCR_QUEUE_TIMEOUT_MS = 60_000;

/** Un reconocimiento a la vez por proceso: tesseract usa mucha memoria (WASM). */
const OCR_SLOTS_KEY = Symbol.for("reclutamiento.ocr.slots");
type OcrGlobal = typeof globalThis & { [OCR_SLOTS_KEY]?: Semaphore };
// En `globalThis`: si Next instancia el módulo más de una vez, el límite sigue siendo 1 por proceso.
const ocrGlobal = globalThis as OcrGlobal;
const ocrSlots = (ocrGlobal[OCR_SLOTS_KEY] ??= new Semaphore(1));

type SpaData = { langPath: string; gzip: boolean };

/**
 * Resuelve el paquete de datos desde la raíz del proyecto (`process.cwd()`):
 * funciona igual en desarrollo y en el servidor empaquetado, y la ruta no se
 * escribe a mano.
 */
function loadSpaData(): SpaData {
  const projectRequire = createRequire(path.join(process.cwd(), "package.json"));
  return projectRequire("@tesseract.js-data/spa") as SpaData;
}

type TesseractWorker = {
  recognize(image: Uint8Array): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

/** Reconoce las imágenes con tesseract.js; el worker se termina SIEMPRE al final. */
async function recognizePages(pages: Uint8Array[], timeoutMs: number): Promise<string | "tiempo_agotado"> {
  const { createWorker } = await import("tesseract.js");
  const spa = loadSpaData();
  const cachePath = path.join(os.tmpdir(), "reclutamiento-ocr");
  mkdirSync(cachePath, { recursive: true });

  const state: { worker: TesseractWorker | null; expired: boolean } = { worker: null, expired: false };
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = (async () => {
    // OEM 1 (LSTM). Datos locales: sin descargas desde internet.
    const created = (await createWorker("spa", 1, {
      langPath: spa.langPath,
      gzip: spa.gzip,
      cachePath,
    })) as unknown as TesseractWorker;
    if (state.expired) {
      await created.terminate().catch(() => undefined);
      return "tiempo_agotado" as const;
    }
    state.worker = created;
    const texts: string[] = [];
    for (const page of pages) {
      if (state.expired) return "tiempo_agotado" as const;
      const { data } = await created.recognize(page);
      texts.push(data.text);
    }
    return texts.join("\n\n");
  })();
  const deadline = new Promise<"tiempo_agotado">((resolve) => {
    timer = setTimeout(() => {
      state.expired = true;
      resolve("tiempo_agotado");
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    // La memoria de WASM solo crece: el worker nunca se reutiliza.
    if (state.worker) await state.worker.terminate().catch(() => undefined);
    // Tras el plazo, el trabajo en curso falla al terminar el worker: sin rechazo sin manejar.
    work.catch(() => undefined);
  }
}

export const localTesseractEngine: OcrEngine = {
  id: "local-tesseract",
  extractorVersion: OCR_LOCAL_EXTRACTOR_VERSION,
  available() {
    try {
      loadSpaData();
      return true;
    } catch {
      return false;
    }
  },
  async recognize(bytes: Uint8Array, options: OcrRecognizeOptions = {}): Promise<OcrEngineResult> {
    const release = await ocrSlots.acquire(options.queueTimeoutMs ?? OCR_QUEUE_TIMEOUT_MS);
    if (!release) return { ok: false, reason: "ocupado" };
    try {
      const rendered = await renderPagesInWorker(bytes);
      if (!rendered.ok) {
        return { ok: false, reason: rendered.reason === "tiempo_agotado" ? "tiempo_agotado" : "ocr_fallido" };
      }
      if (rendered.pages.length === 0) return { ok: true, text: "", pagesRead: 0, totalPages: rendered.totalPages };
      try {
        const text = await recognizePages(rendered.pages, OCR_RECOGNIZE_TIMEOUT_MS);
        if (text === "tiempo_agotado") return { ok: false, reason: "tiempo_agotado" };
        return { ok: true, text, pagesRead: rendered.pages.length, totalPages: rendered.totalPages };
      } catch (error) {
        // Solo tipo y código del error: sin texto del CV ni datos personales.
        logServerError("ocr.local", error);
        return { ok: false, reason: "ocr_fallido" };
      }
    } finally {
      release();
    }
  },
};
