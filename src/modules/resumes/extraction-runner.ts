import "server-only";
import { Worker } from "node:worker_threads";
import type { ResumeFileKind } from "./extraction-core.ts";

/**
 * Ejecuta la extracción de texto en un hilo aparte (`worker_threads`) con
 * límites de memoria y pila, y un plazo máximo. `Promise.race` con un
 * temporizador no detiene un trabajo de CPU; `worker.terminate()` sí.
 */
export type WorkerFailure = "tiempo_agotado" | "recursos_agotados" | "lectura_fallida";
export type WorkerResult = { ok: true; text: string } | { ok: false; reason: WorkerFailure };

export const EXTRACTION_TIMEOUT_MS = 20_000;

/** Límites del isolate del worker. No cubren memoria externa (ArrayBuffers). */
export const EXTRACTION_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 384,
  maxYoungGenerationSizeMb: 48,
  stackSizeMb: 4,
} as const;

/** Extracciones simultáneas por proceso; las demás esperan en cola. */
export const MAX_CONCURRENT_EXTRACTIONS = 2;
/** Espera máxima en cola (aparte del plazo de la extracción, que corre desde que empieza). */
export const EXTRACTION_QUEUE_TIMEOUT_MS = 30_000;

/** Semáforo con cola FIFO y plazo de espera. */
export class Semaphore {
  private available: number;
  private readonly waiting: { grant: () => void }[] = [];

  constructor(permits: number) {
    this.available = permits;
  }

  /** Devuelve la función que libera el permiso, o null si venció el plazo de espera. */
  acquire(timeoutMs: number): Promise<(() => void) | null> {
    const release = () => {
      const next = this.waiting.shift();
      if (next) next.grant();
      else this.available++;
    };
    if (this.available > 0) {
      this.available--;
      return Promise.resolve(release);
    }
    return new Promise((resolve) => {
      const entry = {
        grant: () => {
          clearTimeout(timer);
          resolve(release);
        },
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        resolve(null);
      }, timeoutMs);
      this.waiting.push(entry);
    });
  }
}

const EXTRACTION_SLOTS_KEY = Symbol.for("reclutamiento.extraction.slots");
type ExtractionGlobal = typeof globalThis & { [EXTRACTION_SLOTS_KEY]?: Semaphore };
// En `globalThis`: si Next instancia el módulo más de una vez, el límite sigue siendo por proceso.
const extractionGlobal = globalThis as ExtractionGlobal;
const extractionSlots = (extractionGlobal[EXTRACTION_SLOTS_KEY] ??= new Semaphore(MAX_CONCURRENT_EXTRACTIONS));

export type RunOptions = {
  timeoutMs?: number;
  /** Solo pruebas: espera máxima en cola. */
  queueTimeoutMs?: number;
  /** Solo pruebas: código JS que reemplaza al worker real (se ejecuta con `eval`). */
  testWorkerSource?: string;
};

function startWorker(job: { bytes: Uint8Array; kind: ResumeFileKind }, options: RunOptions): Worker {
  const common = { workerData: job, resourceLimits: EXTRACTION_RESOURCE_LIMITS, stdout: true, stderr: true } as const;
  const worker =
    options.testWorkerSource !== undefined
      ? new Worker(options.testWorkerSource, { ...common, eval: true })
      : new Worker(new URL("./extraction.worker.ts", import.meta.url), common);
  // Salida del worker descartada: sin lector, el búfer crecería sin límite.
  worker.stdout.resume();
  worker.stderr.resume();
  return worker;
}

export async function runExtractionInWorker(
  bytes: Uint8Array,
  kind: ResumeFileKind,
  options: RunOptions = {},
): Promise<WorkerResult> {
  const release = await extractionSlots.acquire(options.queueTimeoutMs ?? EXTRACTION_QUEUE_TIMEOUT_MS);
  if (!release) return { ok: false, reason: "tiempo_agotado" };
  try {
    return await runInWorker(bytes, kind, options);
  } finally {
    release();
  }
}

function runInWorker(bytes: Uint8Array, kind: ResumeFileKind, options: RunOptions): Promise<WorkerResult> {
  const timeoutMs = options.timeoutMs ?? EXTRACTION_TIMEOUT_MS;
  return new Promise<WorkerResult>((resolve) => {
    let worker: Worker;
    try {
      worker = startWorker({ bytes, kind }, options);
    } catch {
      resolve({ ok: false, reason: "lectura_fallida" });
      return;
    }

    let settled = false;
    const finish = (result: WorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Termina el hilo en todos los casos: libera CPU y memoria.
      void worker.terminate().catch(() => undefined);
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: "tiempo_agotado" }), timeoutMs);

    worker.once("message", (message: { ok?: boolean; text?: unknown; exhausted?: boolean }) => {
      if (message?.ok === true && typeof message.text === "string") finish({ ok: true, text: message.text });
      else finish({ ok: false, reason: message?.exhausted ? "recursos_agotados" : "lectura_fallida" });
    });
    worker.once("error", (error: NodeJS.ErrnoException) => {
      const exhausted = error.code === "ERR_WORKER_OUT_OF_MEMORY" || error instanceof RangeError;
      finish({ ok: false, reason: exhausted ? "recursos_agotados" : "lectura_fallida" });
    });
    worker.once("exit", () => finish({ ok: false, reason: "lectura_fallida" }));
  });
}
