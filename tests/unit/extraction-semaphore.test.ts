import { describe, expect, it } from "vitest";
import { MAX_CONCURRENT_EXTRACTIONS, runExtractionInWorker, Semaphore } from "@/modules/resumes/extraction-runner";

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

describe("semáforo de extracciones", () => {
  it("el límite por proceso es de 2", () => {
    expect(MAX_CONCURRENT_EXTRACTIONS).toBe(2);
  });

  it("admite hasta N permisos y el siguiente espera hasta que se libere uno (FIFO)", async () => {
    const semaphore = new Semaphore(2);
    const a = await semaphore.acquire(1000);
    const b = await semaphore.acquire(1000);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const order: string[] = [];
    const c = semaphore.acquire(1000).then((release) => {
      order.push("c");
      return release;
    });
    const d = semaphore.acquire(1000).then((release) => {
      order.push("d");
      return release;
    });
    await tick();
    expect(order).toEqual([]);
    a!();
    await tick();
    expect(order).toEqual(["c"]);
    b!();
    await tick();
    expect(order).toEqual(["c", "d"]);
    (await c)!();
    (await d)!();
    // Todo liberado: vuelven a estar disponibles los dos permisos.
    const again = await Promise.all([semaphore.acquire(10), semaphore.acquire(10)]);
    expect(again.every((release) => release !== null)).toBe(true);
  });

  it("quien espera más que su plazo recibe null y sale de la cola sin perder permisos", async () => {
    const semaphore = new Semaphore(1);
    const held = await semaphore.acquire(1000);
    expect(await semaphore.acquire(20)).toBeNull();
    held!();
    const next = await semaphore.acquire(20);
    expect(next).not.toBeNull();
  });

  it("el permiso pasa directamente a quien espera: no se concede de más", async () => {
    const semaphore = new Semaphore(1);
    const first = await semaphore.acquire(1000);
    const waiting = semaphore.acquire(1000);
    first!();
    const second = await waiting;
    expect(second).not.toBeNull();
    expect(await semaphore.acquire(20)).toBeNull();
    second!();
  });

  it("runExtractionInWorker: con los dos cupos ocupados y plazo de cola corto responde tiempo_agotado", async () => {
    const slow = { timeoutMs: 1500, testWorkerSource: "for (;;) {}" };
    const bytes = new Uint8Array([1]);
    const running = [runExtractionInWorker(bytes, "pdf", slow), runExtractionInWorker(bytes, "pdf", slow)];
    await tick(50);
    const queued = await runExtractionInWorker(bytes, "pdf", { ...slow, queueTimeoutMs: 100 });
    expect(queued).toEqual({ ok: false, reason: "tiempo_agotado" });
    const results = await Promise.all(running);
    expect(results.map((result) => result.ok)).toEqual([false, false]);
  });
});
