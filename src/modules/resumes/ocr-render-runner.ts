import "server-only";
import { Worker } from "node:worker_threads";
import type { WorkerFailure } from "./extraction-runner";

/**
 * Ejecuta el renderizado de páginas para OCR en un hilo aparte, con el mismo
 * patrón que extraction-runner.ts: límites de memoria y pila, plazo máximo y
 * `worker.terminate()` en todos los casos. La cola la gobierna el semáforo del
 * motor de OCR, no este módulo.
 */
export type RenderResult =
  | { ok: true; pages: Uint8Array[]; totalPages: number }
  | { ok: false; reason: WorkerFailure };

export const OCR_RENDER_TIMEOUT_MS = 30_000;

/** Algo más holgados que la extracción: un PNG de 300 dpi pesa más que el texto. */
export const OCR_RENDER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 512,
  maxYoungGenerationSizeMb: 64,
  stackSizeMb: 4,
} as const;

export type RenderOptions = {
  timeoutMs?: number;
  /** Solo pruebas: código JS que reemplaza al worker real (se ejecuta con `eval`). */
  testWorkerSource?: string;
};

function startWorker(bytes: Uint8Array, options: RenderOptions): Worker {
  const common = { workerData: { bytes }, resourceLimits: OCR_RENDER_RESOURCE_LIMITS, stdout: true, stderr: true } as const;
  const worker =
    options.testWorkerSource !== undefined
      ? new Worker(options.testWorkerSource, { ...common, eval: true })
      : new Worker(new URL("./ocr-render.worker.ts", import.meta.url), common);
  worker.stdout.resume();
  worker.stderr.resume();
  return worker;
}

export function renderPagesInWorker(bytes: Uint8Array, options: RenderOptions = {}): Promise<RenderResult> {
  const timeoutMs = options.timeoutMs ?? OCR_RENDER_TIMEOUT_MS;
  return new Promise<RenderResult>((resolve) => {
    let worker: Worker;
    try {
      worker = startWorker(bytes, options);
    } catch {
      resolve({ ok: false, reason: "lectura_fallida" });
      return;
    }

    let settled = false;
    const finish = (result: RenderResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "tiempo_agotado" }), timeoutMs);

    worker.once("message", (message: { ok?: boolean; pages?: unknown; totalPages?: unknown; exhausted?: boolean }) => {
      if (
        message?.ok === true &&
        Array.isArray(message.pages) &&
        message.pages.every((page) => page instanceof Uint8Array) &&
        typeof message.totalPages === "number"
      ) {
        finish({ ok: true, pages: message.pages as Uint8Array[], totalPages: message.totalPages });
      } else finish({ ok: false, reason: message?.exhausted ? "recursos_agotados" : "lectura_fallida" });
    });
    worker.once("error", (error: NodeJS.ErrnoException) => {
      const exhausted = error.code === "ERR_WORKER_OUT_OF_MEMORY" || error instanceof RangeError;
      finish({ ok: false, reason: exhausted ? "recursos_agotados" : "lectura_fallida" });
    });
    worker.once("exit", () => finish({ ok: false, reason: "lectura_fallida" }));
  });
}
