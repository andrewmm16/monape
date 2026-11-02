import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES, NOT_REPAIRABLE, PortalError } from "../../bot/src/errors";
import type { IncidentInput, IncidentRecorder } from "../../bot/src/incidents";
import { MemoryPublishJournal } from "../../bot/src/journal";
import { processQueue, syncApplicants, type RunnerDeps } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { ApplicantSummary, PortalAdapter } from "../../bot/src/types";
import { MemoryApi, PUBLICATION_ID, job } from "../fixtures/bot";

/** Retiro sin perder postulantes y ofertas que ya no existen en el portal. */
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
const recorder: IncidentRecorder = {
  async record(input) {
    incidents.push(input);
  },
};
const deps = (adapter: PortalAdapter): RunnerDeps => ({
  api,
  adapter,
  seen: new MemorySeenStore(),
  log: (message) => void logs.push(message),
  incidents: recorder,
  journal: new MemoryPublishJournal(),
  pauseMs: 0,
  maxJobs: 10,
});
const withdrawal = () => job({ action: "retirar", externalId: "ext-1" });

beforeEach(() => {
  api = new MemoryApi();
  logs = [];
  incidents = [];
});

describe("retiro de una oferta: última revisión de postulantes", () => {
  it("trae los postulantes nuevos ANTES de retirar la oferta", async () => {
    const order: string[] = [];
    const adapter = makeAdapter({
      listApplicants: vi.fn(async () => [applicant("a")]),
      withdraw: vi.fn(async () => void order.push("retirar")),
    });
    api.queue.push(withdrawal());
    const original = api.sendApplicant.bind(api);
    api.sendApplicant = async (...args) => {
      order.push("enviar");
      return original(...args);
    };
    expect(await processQueue(deps(adapter))).toEqual({ halted: false });
    expect(order).toEqual(["enviar", "retirar"]);
    expect(api.sent.map((s) => s.applicant.externalId)).toEqual(["a"]);
    expect(api.reports.at(-1)?.body).toEqual({ outcome: "retirada" });
  });

  it("si no logra bajar un CV, NO retira (se reintenta) y reporta el fallo", async () => {
    const adapter = makeAdapter({
      listApplicants: vi.fn(async () => [applicant("a")]),
      downloadResume: vi.fn(async () => {
        throw new Error("el enlace del CV no responde");
      }),
    });
    api.queue.push(withdrawal());
    await processQueue(deps(adapter));
    expect(adapter.withdraw).not.toHaveBeenCalled();
    expect(api.reports.at(-1)?.body).toMatchObject({ outcome: "error" });
  });

  it("si no puede leer la lista de postulantes (portal caído), NO retira", async () => {
    const adapter = makeAdapter({
      listApplicants: vi.fn(async () => {
        throw new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://x");
      }),
    });
    api.queue.push(withdrawal());
    await processQueue(deps(adapter));
    expect(adapter.withdraw).not.toHaveBeenCalled();
    expect(api.reports.at(-1)?.body).toEqual({ outcome: "error", errorCode: ERROR_CODES.portalUnreachable });
  });

  it("si la oferta ya no existe en el portal, da el retiro por hecho sin intentar retirar", async () => {
    const adapter = makeAdapter({
      listApplicants: vi.fn(async () => {
        throw new PortalError(ERROR_CODES.offerNotFound);
      }),
    });
    api.queue.push(withdrawal());
    await processQueue(deps(adapter));
    expect(adapter.withdraw).not.toHaveBeenCalled();
    expect(api.reports.at(-1)?.body).toEqual({ outcome: "retirada" });
  });

  it("una sesión vencida durante la última revisión detiene al robot", async () => {
    const adapter = makeAdapter({
      listApplicants: vi.fn(async () => {
        throw new PortalError(ERROR_CODES.sessionExpired);
      }),
    });
    api.queue.push(withdrawal());
    expect(await processQueue(deps(adapter))).toEqual({ halted: true, reason: ERROR_CODES.sessionExpired });
    expect(adapter.withdraw).not.toHaveBeenCalled();
  });
});

describe("oferta que desaparece del portal", () => {
  const active = { publicationId: PUBLICATION_ID, externalId: "ext-1", externalUrl: "https://portal.test/o/1", lastSyncedAt: null };

  it("se deja de visitar en los ciclos siguientes y el incidente no es reparable", async () => {
    api.activePublications = [active];
    const adapter = makeAdapter({
      listApplicants: vi.fn(async () => {
        throw new PortalError(ERROR_CODES.offerNotFound);
      }),
    });
    const shared = deps(adapter);
    expect(await syncApplicants(shared)).toEqual({ halted: false });
    expect(await syncApplicants(shared)).toEqual({ halted: false });
    expect(adapter.listApplicants).toHaveBeenCalledTimes(1);
    expect(incidents).toHaveLength(1);
    expect(NOT_REPAIRABLE.has(ERROR_CODES.offerNotFound)).toBe(true);
    expect(api.synced).toEqual([]);
  });

  it("pasada una hora se vuelve a mirar", async () => {
    vi.useFakeTimers();
    try {
      api.activePublications = [active];
      const adapter = makeAdapter({
        listApplicants: vi.fn(async () => {
          throw new PortalError(ERROR_CODES.offerNotFound);
        }),
      });
      const shared = deps(adapter);
      await syncApplicants(shared);
      vi.advanceTimersByTime(61 * 60_000);
      await syncApplicants(shared);
      expect(adapter.listApplicants).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
