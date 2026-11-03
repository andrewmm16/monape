import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES, PortalError } from "../../bot/src/errors";
import { createHealthSchedule, processQueue, runCycle, syncApplicants, type RunnerDeps } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { ActivePublication, ApplicantSummary, PortalAdapter } from "../../bot/src/types";
import { MemoryApi, PUBLICATION_ID, job } from "../fixtures/bot";

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
    downloadResume: vi.fn(async (_p, a) => ({ filename: `${a.externalId}.pdf`, bytes: new Uint8Array([1, 2, 3]) })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

let api: MemoryApi;
let logs: string[];
const deps = (adapter: PortalAdapter): RunnerDeps => ({
  api,
  adapter,
  seen: new MemorySeenStore(),
  log: (message) => void logs.push(message),
  pauseMs: 0,
  maxJobs: 10,
});

beforeEach(() => {
  api = new MemoryApi();
  logs = [];
});

describe("cola de publicaciones", () => {
  it("publica y reporta el id y el enlace de la oferta", async () => {
    api.queue.push(job());
    const adapter = makeAdapter();
    const result = await processQueue(deps(adapter));
    expect(result.halted).toBe(false);
    expect(api.reports).toEqual([
      { publicationId: PUBLICATION_ID, body: { outcome: "publicada", externalId: "ext-1", externalUrl: "https://portal.test/o/1" } },
    ]);
  });

  it("retira la oferta con su id externo", async () => {
    api.queue.push(job({ action: "retirar", externalId: "ext-9" }));
    const adapter = makeAdapter();
    await processQueue(deps(adapter));
    expect(adapter.withdraw).toHaveBeenCalledWith("ext-9");
    expect(api.reports[0]!.body).toEqual({ outcome: "retirada" });
  });

  it("un retiro sin id externo ni diario no toca el portal a ciegas: se da por retirado y queda como incidente", async () => {
    api.queue.push(job({ action: "retirar", externalId: null }));
    const adapter = makeAdapter();
    await processQueue(deps(adapter));
    expect(adapter.withdraw).not.toHaveBeenCalled();
    expect(api.reports[0]!.body).toEqual({ outcome: "retirada" });
  });

  it.each([ERROR_CODES.verificationRequired, ERROR_CODES.sessionExpired])(
    "se detiene ante %s y no atiende más trabajos",
    async (code) => {
      api.queue.push(job(), job({ publicationId: "otro" }));
      const adapter = makeAdapter({
        publish: vi.fn(async () => {
          throw new PortalError(code);
        }),
      });
      const result = await processQueue(deps(adapter));
      expect(result).toEqual({ halted: true, reason: code });
      expect(adapter.publish).toHaveBeenCalledTimes(1);
      expect(api.reports).toHaveLength(1);
      expect(api.reports[0]!.body).toEqual({ outcome: "error", errorCode: code });
      expect(api.queue).toHaveLength(1);
    },
  );

  it("un rechazo del portal no detiene al robot; un error inesperado se reporta como cambio de página", async () => {
    api.queue.push(job({ publicationId: "a" }), job({ publicationId: "b" }), job({ publicationId: "c" }));
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new PortalError(ERROR_CODES.publicationRejected))
      .mockRejectedValueOnce(new Error("Timeout 3000ms exceeded"))
      .mockResolvedValueOnce({ externalId: "e", externalUrl: "u" });
    const result = await processQueue(deps(makeAdapter({ publish })));
    expect(result.halted).toBe(true);
    expect(result.reason).toBe("fallos_seguidos");
    expect(api.reports.map((r) => r.body)).toEqual([
      { outcome: "error", errorCode: ERROR_CODES.publicationRejected },
      { outcome: "error", errorCode: ERROR_CODES.pageChanged },
    ]);
    expect(api.queue).toHaveLength(1);
  });

  it("reintenta informar si la app falla un momento", async () => {
    api.queue.push(job());
    api.reportFailures = 2;
    const result = await processQueue(deps(makeAdapter()));
    expect(result.halted).toBe(false);
    expect(api.reports).toHaveLength(1);
  });

  it("si no logra informar, se detiene y deja constancia del enlace para no publicar dos veces", async () => {
    vi.useFakeTimers();
    try {
      api.queue.push(job(), job({ publicationId: "otro" }));
      api.reportFailures = 99;
      const adapter = makeAdapter();
      const promise = processQueue(deps(adapter));
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toEqual({ halted: true, reason: "api_no_disponible" });
      expect(adapter.publish).toHaveBeenCalledTimes(1);
      expect(logs.some((line) => line.includes("https://portal.test/o/1"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("respeta el máximo de trabajos por ciclo", async () => {
    for (let i = 0; i < 5; i++) api.queue.push(job({ publicationId: `p${i}` }));
    await processQueue({ ...deps(makeAdapter()), maxJobs: 2 });
    expect(api.reports).toHaveLength(2);
    expect(api.queue).toHaveLength(3);
  });
});

describe("postulantes", () => {
  it("entrega los nuevos con su CV y marca la oferta como revisada", async () => {
    api.activePublications = [ACTIVE];
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a"), applicant("b")]) });
    await syncApplicants(deps(adapter));
    expect(api.sent.map((s) => s.applicant.externalId)).toEqual(["a", "b"]);
    expect(api.sent[0]!.resume.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(api.synced).toEqual([PUBLICATION_ID]);
  });

  it("se salta las ofertas publicadas a mano (manual=true): no abre el portal, no baja CVs ni marca nada", async () => {
    api.activePublications = [{ ...ACTIVE, manual: true }];
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a")]) });
    expect(await syncApplicants(deps(adapter))).toEqual({ halted: false });
    expect(adapter.listApplicants).not.toHaveBeenCalled();
    expect(adapter.downloadResume).not.toHaveBeenCalled();
    expect(api.sent).toHaveLength(0);
    expect(api.synced).toEqual([]);
    expect(logs).toEqual([]); // y sin ruido en el log
  });

  it("las manuales no estorban a las del robot: se revisan solo las del robot; manual=false o ausente cuentan como del robot", async () => {
    const other = { ...ACTIVE, publicationId: "22222222-2222-4222-8222-222222222222", externalId: "ext-2" };
    const third = { ...ACTIVE, publicationId: "33333333-3333-4333-8333-333333333333", externalId: "ext-3", manual: false };
    api.activePublications = [{ ...ACTIVE, manual: true }, other, third];
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a")]) });
    await syncApplicants(deps(adapter));
    expect(adapter.listApplicants).toHaveBeenCalledTimes(2);
    expect(api.synced.sort()).toEqual([other.publicationId, third.publicationId].sort());
  });

  it("no vuelve a bajar el CV de quien ya se entregó", async () => {
    api.activePublications = [ACTIVE];
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a")]) });
    const shared = deps(adapter);
    await syncApplicants(shared);
    await syncApplicants(shared);
    expect(adapter.downloadResume).toHaveBeenCalledTimes(1);
    expect(api.sent).toHaveLength(1);
  });

  it("ya_registrada y archivo inválido cuentan como atendidos, sin reintentar", async () => {
    api.activePublications = [ACTIVE];
    api.sendStatus = "invalida";
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a")]) });
    const shared = deps(adapter);
    await syncApplicants(shared);
    await syncApplicants(shared);
    expect(adapter.downloadResume).toHaveBeenCalledTimes(1);
    expect(api.synced).toHaveLength(2);
  });

  it("si falla un CV no lo marca como entregado ni marca la oferta como revisada, y sigue con los demás", async () => {
    api.activePublications = [ACTIVE];
    const downloadResume = vi
      .fn()
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValue({ filename: "b.pdf", bytes: new Uint8Array([9]) });
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a"), applicant("b")]), downloadResume });
    const shared = deps(adapter);
    await syncApplicants(shared);
    expect(api.sent.map((s) => s.applicant.externalId)).toEqual(["b"]);
    expect(api.synced).toEqual([]);
    await syncApplicants(shared);
    expect(api.sent.map((s) => s.applicant.externalId)).toEqual(["b", "a"]);
    expect(api.synced).toEqual([PUBLICATION_ID]);
  });

  it("se detiene si el portal pide intervención humana", async () => {
    api.activePublications = [ACTIVE];
    const adapter = makeAdapter({
      listApplicants: vi.fn(async () => {
        throw new PortalError(ERROR_CODES.sessionExpired);
      }),
    });
    const result = await syncApplicants(deps(adapter));
    expect(result).toEqual({ halted: true, reason: ERROR_CODES.sessionExpired });
    expect(api.synced).toEqual([]);
  });

  it("ignora ofertas sin id externo y no registra datos personales en el log", async () => {
    api.activePublications = [{ ...ACTIVE, externalId: null }, { ...ACTIVE, publicationId: "p2" }];
    const adapter = makeAdapter({ listApplicants: vi.fn(async () => [applicant("a")]) });
    await syncApplicants(deps(adapter));
    expect(adapter.listApplicants).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).not.toContain("Persona a");
  });

  it("runCycle no lee postulantes si la cola pidió detenerse", async () => {
    api.queue.push(job());
    api.activePublications = [ACTIVE];
    const adapter = makeAdapter({
      publish: vi.fn(async () => {
        throw new PortalError(ERROR_CODES.verificationRequired);
      }),
    });
    const result = await runCycle(deps(adapter));
    expect(result.halted).toBe(true);
    expect(adapter.listApplicants).not.toHaveBeenCalled();
  });

  it("informa a la app que sigue activo al terminar un ciclo normal", async () => {
    await runCycle(deps(makeAdapter()));
    expect(api.statuses).toEqual([{ state: "activo", reason: undefined }]);
  });

  it("informa que necesita a una persona, con la causa, cuando se detiene", async () => {
    api.queue.push(job());
    const adapter = makeAdapter({
      publish: vi.fn(async () => {
        throw new PortalError(ERROR_CODES.verificationRequired);
      }),
    });
    await runCycle(deps(adapter));
    expect(api.statuses).toEqual([{ state: "necesita_persona", reason: ERROR_CODES.verificationRequired }]);
  });

  it("si la app no recibe el estado, el ciclo no falla", async () => {
    api.reportStatus = async () => {
      throw new Error("app caída");
    };
    const result = await runCycle(deps(makeAdapter()));
    expect(result.halted).toBe(false);
    expect(logs.some((line) => line.includes("No se pudo informar el estado"))).toBe(true);
  });

  describe("prueba de estructura del portal", () => {
    const clock = { now: 1_000_000 };
    const withHealth = (adapter: PortalAdapter): RunnerDeps => ({ ...deps(adapter), health: createHealthSchedule(24, () => clock.now) });
    beforeEach(() => {
      clock.now = 1_000_000;
    });

    it("se hace en el primer ciclo y luego una vez al día", async () => {
      const adapter = makeAdapter();
      const shared = withHealth(adapter);
      await runCycle(shared);
      await runCycle(shared);
      expect(adapter.healthCheck).toHaveBeenCalledTimes(1);
      clock.now += 25 * 3_600_000;
      await runCycle(shared);
      expect(adapter.healthCheck).toHaveBeenCalledTimes(2);
    });

    it("sin programación no se hace", async () => {
      const adapter = makeAdapter();
      await runCycle(deps(adapter));
      expect(adapter.healthCheck).not.toHaveBeenCalled();
    });

    it("si falla, se detiene antes de tocar la cola e informa la causa", async () => {
      vi.useFakeTimers();
      try {
        api.queue.push(job());
        const adapter = makeAdapter({
          healthCheck: vi.fn(async () => {
            throw new PortalError(ERROR_CODES.pageChanged, "falta #titulo");
          }),
        });
        const promise = runCycle(withHealth(adapter));
        await vi.runAllTimersAsync();
        const result = await promise;
        expect(result).toEqual({ halted: true, reason: ERROR_CODES.pageChanged });
        expect(adapter.healthCheck).toHaveBeenCalledTimes(2);
        expect(adapter.publish).not.toHaveBeenCalled();
        expect(api.queue).toHaveLength(1);
        expect(api.statuses).toEqual([{ state: "necesita_persona", reason: ERROR_CODES.pageChanged }]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("un fallo aislado (red) no detiene: el segundo intento pasa", async () => {
      vi.useFakeTimers();
      try {
        const healthCheck = vi.fn().mockRejectedValueOnce(new Error("net::ERR")).mockResolvedValue(undefined);
        const promise = runCycle(withHealth(makeAdapter({ healthCheck })));
        await vi.runAllTimersAsync();
        expect((await promise).halted).toBe(false);
        expect(healthCheck).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([ERROR_CODES.verificationRequired, ERROR_CODES.sessionExpired])("%s no se reintenta", async (code) => {
      const healthCheck = vi.fn(async () => {
        throw new PortalError(code);
      });
      const result = await runCycle(withHealth(makeAdapter({ healthCheck })));
      expect(result).toEqual({ halted: true, reason: code });
      expect(healthCheck).toHaveBeenCalledTimes(1);
    });
  });
});
