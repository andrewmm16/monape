/** `extractor_version` del motor local; también lo usa el registro de lotes. */
export const OCR_LOCAL_EXTRACTOR_VERSION = "ocr-local-tesseract7-spa";

/** Motivo por el que un motor de OCR no devolvió texto. */
export type OcrFailureReason = "tiempo_agotado" | "ocr_fallido" | "ocupado";

export type OcrEngineResult =
  | { ok: true; text: string; pagesRead: number; totalPages: number }
  | { ok: false; reason: OcrFailureReason };

/**
 * Motor de reconocimiento de texto de un PDF escaneado. Recibe el PDF completo
 * (cada motor decide cómo leerlo) y no lanza: informa el fallo en el resultado.
 */
export type OcrRecognizeOptions = {
  /** Espera máxima en la cola del motor (por defecto la propia del motor). */
  queueTimeoutMs?: number;
};

export type OcrEngine = {
  id: string;
  /** Valor para `extractor_version` (máx. 40 caracteres). */
  extractorVersion: string;
  available(): boolean;
  recognize(bytes: Uint8Array, options?: OcrRecognizeOptions): Promise<OcrEngineResult>;
};

export type OcrRun =
  | { status: "no_disponible" }
  | { status: "ocupado" }
  | { status: "ok"; engine: OcrEngine; text: string; pagesRead: number; totalPages: number }
  | { status: "fallido"; engine: OcrEngine; reason: Exclude<OcrFailureReason, "ocupado"> };
