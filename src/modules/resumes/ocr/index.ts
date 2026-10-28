import "server-only";
import { localTesseractEngine } from "./local-tesseract";
import { logServerError } from "@/lib/errors";
import type { OcrEngine, OcrRecognizeOptions, OcrRun } from "./types";

export type { OcrEngine, OcrEngineResult, OcrFailureReason, OcrRun } from "./types";

/**
 * Motores en orden de prioridad: se prueba el primero disponible y, si falla o
 * no está disponible, se pasa al siguiente.
 *
 * Pendiente: el motor de IA (Claude) irá AQUÍ, antes del local. Solo estará
 * disponible con la IA aprobada (`getAiAvailability`); el local es el respaldo
 * gratuito que no envía datos fuera.
 */
export const OCR_ENGINES: OcrEngine[] = [localTesseractEngine];

export async function runOcrWithEngines(
  engines: OcrEngine[],
  bytes: Uint8Array,
  options: OcrRecognizeOptions = {},
): Promise<OcrRun> {
  let last: OcrRun = { status: "no_disponible" };
  for (const engine of engines) {
    if (!engine.available()) continue;
    const result = await engine.recognize(bytes, options).catch((error: unknown): { ok: false; reason: "ocr_fallido" } => {
      // Solo tipo y código del error: sin texto del CV ni datos personales.
      logServerError("ocr.engine", error);
      return { ok: false, reason: "ocr_fallido" };
    });
    if (result.ok) {
      return { status: "ok", engine, text: result.text, pagesRead: result.pagesRead, totalPages: result.totalPages };
    }
    last = result.reason === "ocupado" ? { status: "ocupado" } : { status: "fallido", engine, reason: result.reason };
  }
  return last;
}

/** Lee un PDF escaneado con el primer motor que lo consiga. */
export function runOcr(bytes: Uint8Array, options: OcrRecognizeOptions = {}): Promise<OcrRun> {
  return runOcrWithEngines(OCR_ENGINES, bytes, options);
}
