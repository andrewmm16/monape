import "server-only";
import { runExtractionInWorker, type RunOptions, type WorkerFailure } from "./extraction-runner";
import type { ResumeKind } from "./file-validation";
import { runOcr } from "./ocr";
import type { OcrRecognizeOptions, OcrRun } from "./ocr/types";
import { suggestFields, SUGGESTIONS_VERSION, type SuggestedFields } from "./suggestions";

export const EXTRACTOR_VERSION = "extractor-v1";

const MAX_TEXT_LENGTH = 200_000;
const MIN_USEFUL_TEXT = 80;

export type ExtractionOutcome = {
  status: "completada" | "sin_texto" | "fallida";
  method: "pdf_text" | "docx_text" | "pdf_ocr";
  /** Identifica el extractor (o el motor de OCR) que produjo el resultado. */
  extractorVersion: string;
  text: string | null;
  warnings: string[];
  errorCode: string | null;
  suggestions: SuggestedFields & { version: string };
};

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FAILURE_WARNINGS: Record<WorkerFailure, string> = {
  tiempo_agotado: "La extracción superó el tiempo máximo.",
  recursos_agotados: "El documento exige demasiados recursos para leerse.",
  lectura_fallida: "No se pudo leer el documento (puede estar dañado o protegido con contraseña).",
};

export const OCR_NOTICE =
  "Texto obtenido por reconocimiento automático de imagen (OCR local). Puede contener errores: revíselo antes de decidir.";

export type ExtractOptions = RunOptions & {
  /**
   * `inline`: si el PDF no tiene texto, intenta leerlo como escaneado (OCR) en
   * la misma solicitud. Sin esta opción el PDF queda `pdf_text` + `sin_texto`
   * (OCR aún no intentado).
   */
  ocr?: "inline";
};

/**
 * Convierte el resultado del OCR en un resultado de extracción. Devuelve null si
 * el OCR no llegó a intentarse (sin motor disponible o ocupado): el CV queda
 * como estaba y se podrá intentar después.
 */
export function outcomeFromOcr(run: OcrRun): ExtractionOutcome | null {
  const empty = { skills: [], version: SUGGESTIONS_VERSION };
  if (run.status === "no_disponible" || run.status === "ocupado") return null;
  if (run.status === "fallido") {
    return {
      status: "sin_texto",
      method: "pdf_ocr",
      extractorVersion: run.engine.extractorVersion,
      text: null,
      warnings: ["No se pudo leer el escaneo automáticamente. Puede transcribir el contenido manualmente."],
      errorCode: run.reason === "tiempo_agotado" ? "tiempo_agotado" : "ocr_fallido",
      suggestions: empty,
    };
  }
  let text = normalizeExtractedText(run.text);
  const warnings: string[] = [];
  if (run.totalPages > run.pagesRead) {
    warnings.push(`Solo se leyeron las primeras ${run.pagesRead} páginas de ${run.totalPages}.`);
  }
  if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);
  if (text.length < MIN_USEFUL_TEXT) {
    return {
      status: "sin_texto",
      method: "pdf_ocr",
      extractorVersion: run.engine.extractorVersion,
      text: text || null,
      warnings: [...warnings, "El reconocimiento automático no encontró texto útil. Puede transcribir el contenido manualmente."],
      errorCode: null,
      suggestions: empty,
    };
  }
  return {
    status: "completada",
    method: "pdf_ocr",
    extractorVersion: run.engine.extractorVersion,
    text,
    warnings: [OCR_NOTICE, ...warnings],
    errorCode: null,
    suggestions: { ...suggestFields(text), version: SUGGESTIONS_VERSION },
  };
}

/** El CV quedó sin texto y el OCR aún no se intentó (apto para OCR automático). */
export function needsOcr(extraction: Pick<ExtractionOutcome, "status" | "method">): boolean {
  return extraction.method === "pdf_text" && extraction.status === "sin_texto";
}

/** Lee un PDF escaneado con OCR. Null si no se pudo intentar (ver `outcomeFromOcr`). */
export async function extractScannedResume(
  bytes: Uint8Array,
  options: OcrRecognizeOptions = {},
): Promise<ExtractionOutcome | null> {
  return outcomeFromOcr(await runOcr(bytes, options));
}

function failedOutcome(
  method: ExtractionOutcome["method"],
  reason: WorkerFailure,
  suggestions: ExtractionOutcome["suggestions"],
): ExtractionOutcome {
  return {
    status: "fallida",
    method,
    extractorVersion: EXTRACTOR_VERSION,
    text: null,
    warnings: [FAILURE_WARNINGS[reason]],
    errorCode: reason,
    suggestions,
  };
}

/**
 * Extrae el texto de un CV ya validado. Nunca inventa datos: si el documento
 * no tiene texto legible (p. ej. PDF escaneado), lo indica y no sugiere nada.
 * La lectura corre en un worker con límites de memoria y plazo; si los excede
 * se termina y el resultado es `fallida` (`tiempo_agotado`, `recursos_agotados`
 * o `lectura_fallida`). `options` existe para las pruebas.
 */
export async function extractResume(
  bytes: Uint8Array,
  kind: ResumeKind,
  options: ExtractOptions = {},
): Promise<ExtractionOutcome> {
  const method = kind === "pdf" ? "pdf_text" : "docx_text";
  const empty = { skills: [], version: SUGGESTIONS_VERSION };
  const result = await runExtractionInWorker(bytes, kind, options);
  if (!result.ok) return failedOutcome(method, result.reason, empty);
  try {
    let text = normalizeExtractedText(result.text);
    const warnings: string[] = [];
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH);
      warnings.push("El texto superaba 200 000 caracteres y se truncó.");
    }
    if (text.length < MIN_USEFUL_TEXT) {
      if (kind === "pdf" && options.ocr === "inline") {
        const scanned = await extractScannedResume(bytes);
        if (scanned?.status === "completada") return scanned;
        if (scanned) {
          // OCR sin resultado útil: se conserva el texto más largo (el digital parcial puede bastar
          // para evaluar), se mezclan los avisos y queda marcado el intento de OCR.
          const best = (scanned.text?.length ?? 0) > text.length ? scanned.text : text || null;
          return { ...scanned, text: best, warnings: [...warnings, ...scanned.warnings] };
        }
      }
      return {
        status: "sin_texto",
        method,
        extractorVersion: EXTRACTOR_VERSION,
        text: text || null,
        warnings: [
          ...warnings,
          kind === "pdf"
            ? "No se encontró texto legible. Puede ser un documento escaneado: se puede leer con reconocimiento automático (OCR) o transcribir manualmente."
            : "No se encontró texto legible. Puede transcribir el contenido manualmente.",
        ],
        errorCode: null,
        suggestions: empty,
      };
    }
    return { status: "completada", method, extractorVersion: EXTRACTOR_VERSION, text, warnings, errorCode: null, suggestions: { ...suggestFields(text), version: SUGGESTIONS_VERSION } };
  } catch {
    return failedOutcome(method, "lectura_fallida", empty);
  }
}
