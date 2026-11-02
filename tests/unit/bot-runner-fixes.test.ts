import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, ERROR_CODES, errorCodeOf, NOT_REPAIRABLE } from "../../bot/src/errors";
import type { IncidentInput, IncidentRecorder } from "../../bot/src/incidents";
import { FilePublishJournal, MemoryPublishJournal } from "../../bot/src/journal";
import { processQueue, syncApplicants, type RunnerDeps } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { ActivePublication, ApplicantSummary, PortalAdapter } from "../../bot/src/types";
import { MemoryApi, PUBLICATION_ID, job } from "../fixtures/bot";

/** Correcciones de la revisión del 2026-10-30: diario de publicaciones, errores de la app y rechazos. */
const ACTIVE: ActivePublication = {
  publicationId: PUBLICATION_ID,
  externalId: "ext-1",
  externalUrl: "https://portal.test/o/1",
  lastSyncedAt: null,
};
const applicant = (id: string): ApplicantSummary => ({ externalId: id, fullName: `Persona ${id}`, resumeRef: `/cv/${id}` });

function makeAdapter(overrides: Partial<PortalAdapter> = {}): PortalAdapter {
  return {
    slug: "trabajos-diarios",
    healthCheck: vi.fn(async () => {}),
    publish: vi.fn(async () => ({ externalId: "ext-1", externalUrl: "https://portal.test/o/1" })),
    withdraw: vi.fn(async () => {}),
    listApplicants: vi.fn(async () => []),
    downloadResume: vi.fn(async (_p, a) => ({ filename: `${a.externalId}.pdf`, bytes: new Uint8Array([1]) })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

let api: MemoryApi;
let logs: string[];
let incidents: IncidentInput[];
let journal: MemoryPublishJournal;
const recorder: IncidentRecorder = {
  async record(input) {
    incidents.push(input);
  },
};
const deps = (adapter: PortalAdapter, overrides: Partial<RunnerDeps> = {}): RunnerDeps => ({
  api,
  adapter,
  seen: new MemorySeenStore(),
  log: (message) => void logs.push(message),
  incidents: recorder,
  journal,
  pauseMs: 0,
  maxJobs: 10,
  ...overrides,
});

beforeEach(() => {
  api = new MemoryApi();
  logs = [];
  incidents = [];
  journal = new MemoryPublishJournal();
});

describe("diario de publicaciones: no se publica dos veces", () => {
  it("si no se pudo informar, el reintento reenvía lo guardado en vez de publicar otra vez", async () => {
    vi.useFakeTimers();
    try {
      const adapter = makeAdapter();
      api.queue.push(job());
      api.reportFailures = 99;
      const first = processQueue(deps(adapter));
      await vi.runAllTimersAsync();
      expect(await first).toEqual({ halted: true, reason: ERROR_CODES.appUnavailable });
      expect(adapter.publish).toHaveBeenCalledTimes(1);
      expect(journal.get(PUBLICATION_ID)).toEqual({ externalId: "ext-1", externalUrl: "https://portal.test/o/1" });

      // La app vuelve y entrega el mismo trabajo (se venció la reserva o se reinició el robot).
      api.reportFailures = 0;
      api.queue.push(job());
      expect(await processQueue(deps(adapter))).toEqual({ halted: false });
      expect(adapter.publish).toHaveBeenCalledTimes(1);
      expect(api.reports).toEqual([
        { publicationId: PUBLICATION_ID, body: { outcome: "publicada", externalId: "ext-1", externalUrl: "https://portal.test/o/1" } },
      ]);
      expect(journal.get(PUBLICATION_ID)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tras informar con éxito el diario queda vacío", async () => {
    api.queue.push(job());
    await processQueue(deps(makeAdapter()));
    expect(journal.get(PUBLICATION_ID)).toBeUndefined();
  });

  it("si la oferta se publicó pero la vacante se cerró, el retiro usa el id guardado en el diario", async () => {
    journal.set(PUBLICATION_ID, { externalId: "ext-tarde", externalUrl: "https://portal.test/o/tarde" });
    api.queue.push(job({ action: "retirar", externalId: null }));
    const adapter = makeAdapter();
    await processQueue(deps(adapter));
    expect(adapter.withdraw).toHaveBeenCalledWith("ext-tarde");
    expect(api.reports[0]!.body).toEqual({ outcome: "retirada" });
    expect(incidents).toEqual([]);
  });

  it("un retiro sin ningún id deja un incidente que exige a una persona", async () => {
    api.queue.push(job({ action: "retirar", externalId: null }));
    await processQueue(deps(makeAdapter()));
    expect(incidents).toHaveLength(1);
    expect(errorCodeOf(incidents[0]!.error)).toBe(ERROR_CODES.withdrawWithoutId);
    expect(NOT_REPAIRABLE.has(ERROR_CODES.withdrawWithoutId)).toBe(true);
  });

  it("si no se puede escribir el diario, igual informa la oferta y deja el enlace en el log", async () => {
    const broken = {
      get: () => undefined,
      set: () => {
        throw new Error("disco lleno");
      },
      remove: () => {},
    };
    api.queue.push(job());
    await processQueue(deps(makeAdapter(), { journal: broken }));
    expect(api.reports[0]!.body).toMatchObject({ outcome: "publicada" });
    expect(logs.some((line) => line.includes("https://portal.test/o/1") && line.includes("diario"))).toBe(true);
  });
});

describe("FilePublishJournal", () => {
  it("sobrevive a un reinicio y escribe de forma atómica", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "diario-"));
    try {
      const file = path.join(dir, "estado", "publicadas.json");
      new FilePublishJournal(file).set("p1", { externalId: "e1", externalUrl: "https://portal.test/o/e1" });
      const reloaded = new FilePublishJournal(file);
      expect(reloaded.get("p1")).toEqual({ externalId: "e1", externalUrl: "https://portal.test/o/e1" });
      reloaded.remove("p1");
      expect(new FilePublishJournal(file).get("p1")).toBeUndefined();
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("un diario dañado avisa y no tumba al robot", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "diario-"));
    try {
      const file = path.join(dir, "publicadas.json");
      await writeFile(file, "{no es json");
      const warnings: string[] = [];
      const damaged = new FilePublishJournal(file, (m) => void warnings.push(m));
      expect(damaged.get("p1")).toBeUndefined();
      expect(warnings.join(" ")).toContain("dañado");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("errores de la app no son errores del portal", () => {
  it("un ApiError se clasifica como app no disponible y no es reparable", () => {
    expect(errorCodeOf(new ApiError(500, "/api/bot/postulantes"))).toBe(ERROR_CODES.appUnavailable);
    expect(NOT_REPAIRABLE.has(ERROR_CODES.appUnavailable)).toBe(true);
  });

  it("si la app falla al entregar un postulante, el ciclo falla sin incidente de portal ni más descargas", async () => {
    api.activePublications = [ACTIVE];
    api.appError = new ApiError(500, "/api/bot/postulantes");
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a"), applicant("b")]) });
    await expect(syncApplicants(deps(adapter))).rejects.toBeInstanceOf(ApiError);
    expect(adapter.downloadResume).toHaveBeenCalledTimes(1);
    expect(incidents).toEqual([]);
  });

  it("un 409 al informar no se reintenta, no detiene al robot y queda como incidente con el enlace", async () => {
    api.queue.push(job(), job({ publicationId: "otro" }));
    api.reportError = new ApiError(409, "/api/bot/publicaciones/x/resultado");
    const adapter = makeAdapter();
    const lines: string[] = [];
    const result = await processQueue(deps(adapter, { log: (m) => void lines.push(m) }));
    expect(result).toEqual({ halted: false });
    expect(lines.filter((line) => line.includes("No se pudo informar"))).toHaveLength(2); // 1 intento por trabajo
    expect(adapter.publish).toHaveBeenCalledTimes(2);
    expect(incidents).toHaveLength(2);
    expect(errorCodeOf(incidents[0]!.error)).toBe(ERROR_CODES.resultRejected);
    expect(String((incidents[0]!.error as Error).message)).toContain("https://portal.test/o/1");
    expect(journal.get(PUBLICATION_ID)).toBeUndefined();
  });

  it("un error de red al informar sí se reintenta (no es un rechazo definitivo)", async () => {
    api.queue.push(job());
    api.reportFailures = 2;
    const result = await processQueue(deps(makeAdapter()));
    expect(result).toEqual({ halted: false });
    expect(api.reports).toHaveLength(1);
  });

  it("un 429 de la app se reintenta", async () => {
    vi.useFakeTimers();
    try {
      api.queue.push(job());
      api.reportError = new ApiError(429, "/x");
      const promise = processQueue(deps(makeAdapter()));
      await vi.runAllTimersAsync();
      expect(await promise).toEqual({ halted: true, reason: ERROR_CODES.appUnavailable });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("postulantes rechazados por la app", () => {
  it("quedan como incidente (sin datos personales) y no se reintentan cada ciclo", async () => {
    api.activePublications = [ACTIVE];
    api.sendStatus = "invalida";
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a")]) });
    const shared = deps(adapter);
    await syncApplicants(shared);
    await syncApplicants(shared);
    expect(adapter.downloadResume).toHaveBeenCalledTimes(1);
    expect(incidents).toHaveLength(1);
    const message = String((incidents[0]!.error as Error).message);
    expect(message).toContain("id externo a");
    expect(message).not.toContain("Persona a");
  });

  it("si no se puede guardar el registro de enviados, no cuenta como fallo del postulante", async () => {
    api.activePublications = [ACTIVE];
    const seen = {
      has: () => false,
      add: () => {
        throw new Error("antivirus bloqueó el archivo");
      },
    };
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a")]) });
    await syncApplicants(deps(adapter, { seen }));
    expect(api.sent).toHaveLength(1);
    expect(api.synced).toEqual([PUBLICATION_ID]);
    expect(incidents).toEqual([]);
  });
});
