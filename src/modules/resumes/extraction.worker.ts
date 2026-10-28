import { parentPort, workerData } from "node:worker_threads";
import { extractRawText, type ResumeFileKind } from "./extraction-core.ts";

/**
 * Entrada del worker de extracción. Recibe `{ bytes, kind }`, responde con
 * `{ ok: true, text }` o `{ ok: false }` y termina. Si agota la memoria o el
 * plazo, quien lo lanzó lo termina (ver extraction-runner.ts).
 */
type Job = { bytes: Uint8Array; kind: ResumeFileKind };

async function main() {
  const { bytes, kind } = workerData as Job;
  try {
    const text = await extractRawText(bytes, kind);
    parentPort?.postMessage({ ok: true, text });
  } catch (error) {
    // Pila agotada: un RangeError por recursión desmedida (documento hostil).
    parentPort?.postMessage({ ok: false, exhausted: error instanceof RangeError });
  }
}

void main();
