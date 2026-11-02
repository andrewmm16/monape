import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeLinkedinAdapter } from "../../bot/src/adapters/fake-linkedin";
import { loadConfig } from "../../bot/src/config";
import { ERROR_CODES, PortalError } from "../../bot/src/errors";
import { startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";
import { FileIncidentStore } from "../../bot/src/incidents";
import { BotControl } from "../../bot/src/notify/control";
import { allStopped, createResumeSchedule, isResumable, resumeDue, runResumeChecks, runRound, type AdapterSlot } from "../../bot/src/round";
import { createHealthSchedule } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { PortalAdapter } from "../../bot/src/types";
import { MemoryApi, job } from "../fixtures/bot";

/** Reanudación automática de un portal detenido por `pagina_cambio`: relojes manuales, sin esperas reales. */
const MIN = 60_000;
const clock = (start = Date.parse("2026-01-01T00:00:00Z")) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

/** Un adaptador cuya prueba de estructura falla con el código dado mientras `failWith` no sea `null`. */
function stubAdapter(slug = "linkedin") {
  const calls = { healthCheck: 0, publish: 0, withdraw: 0, listApplicants: 0, downloadResume: 0 };
  const state = { failWith: ERROR_CODES.pageChanged as string | null };
  const adapter: PortalAdapter = {
    slug,
    healthCheck: async () => {
      calls.healthCheck++;
      if (state.failWith) throw new PortalError(state.failWith, "falta el campo del título");
    },
    publish: async () => {
      calls.publish++;
      return { externalId: "1", externalUrl: "https://x.test/1" };
    },
    withdraw: async () => void calls.withdraw++,
    listApplicants: async () => {
      calls.listApplicants++;
      return [];
    },
    downloadResume: async () => {
      calls.downloadResume++;
      return { filename: "cv.pdf", bytes: new Uint8Array() };
    },
    close: async () => {},
  };
  return { adapter, calls, state };
}

function stubSlot(time: ReturnType<typeof clock>, options: { slug?: string; resume?: boolean; recorder?: FileIncidentStore } = {}) {
  const api = new MemoryApi();
  const stub = stubAdapter(options.slug);
  const logs: string[] = [];
  const slot: AdapterSlot = {
    slug: stub.adapter.slug,
    halted: false,
    resume: options.resume === false ? undefined : createResumeSchedule(5, time.now),
    deps: {
      api,
      adapter: stub.adapter,
      seen: new MemorySeenStore(),
      health: createHealthSchedule(24, time.now),
      incidents: options.recorder,
      log: (message) => logs.push(message),
      pauseMs: 0,
      maxJobs: 5,
    },
  };
  return { slot, api, logs, ...stub };
}

describe("reanudación automática (portal detenido por pagina_cambio)", () => {
  it("la comprobación corre a su hora, solo con healthCheck; si falla sigue detenido y avisa una sola vez en el log", async () => {
    const time = clock();
    const { slot, api, logs, calls } = stubSlot(time);
    api.queue.push(job());
    const round = await runRound([slot], () => {});
    expect(round.newlyHalted).toEqual([{ slug: "linkedin", reason: ERROR_CODES.pageChanged }]);
    expect(isResumable(slot)).toBe(true);
    expect(round.allHalted).toBe(false); // hay un portal que puede volver solo
    const before = { ...calls };

    expect(resumeDue([slot])).toBe(false);
    time.advance(4 * MIN);
    expect(await runResumeChecks([slot], (m) => logs.push(m))).toEqual({ resumed: [], escalated: [] });
    expect(calls.healthCheck).toBe(before.healthCheck); // aún no tocaba

    for (let i = 0; i < 3; i++) {
      time.advance(5 * MIN);
      expect(resumeDue([slot])).toBe(true);
      expect(await runResumeChecks([slot], (m) => logs.push(m))).toEqual({ resumed: [], escalated: [] });
    }
    expect(calls.healthCheck).toBe(before.healthCheck + 3);
    expect(slot.halted).toBe(true);
    expect(logs.filter((l) => l.includes("sigue fallando"))).toHaveLength(1); // sin spam
    // No intentó publicar, retirar ni leer nada, y no tocó la cola ni el estado de la app.
    expect({ publish: calls.publish, withdraw: calls.withdraw, listApplicants: calls.listApplicants, downloadResume: calls.downloadResume }).toEqual({
      publish: 0,
      withdraw: 0,
      listApplicants: 0,
      downloadResume: 0,
    });
    expect(api.queue).toHaveLength(1);
    expect(api.statuses.at(-1)).toMatchObject({ state: "necesita_persona", reason: ERROR_CODES.pageChanged });
  });

  it("si la prueba vuelve a pasar: reanuda, informa «activo», anota la recuperación del incidente y no repite la prueba al instante", async () => {
    const time = clock();
    const dir = mkdtempSync(path.join(tmpdir(), "reanudar-"));
    try {
      const store = new FileIncidentStore(path.join(dir, "incidentes"), () => {}, undefined, () => new Date(time.now()));
      const { slot, api, logs, calls, state } = stubSlot(time, { recorder: store });
      await runRound([slot], () => {});
      const [incident] = await store.list();
      expect(incident).toMatchObject({ portal: "linkedin", step: "prueba_estructura", errorCode: "pagina_cambio", status: "abierto" });
      expect(incident!.recoveredAt).toBeUndefined();

      state.failWith = null;
      time.advance(6 * MIN);
      const checksBefore = calls.healthCheck;
      expect(await runResumeChecks([slot], (m) => logs.push(m))).toEqual({ resumed: ["linkedin"], escalated: [] });
      expect(calls.healthCheck).toBe(checksBefore + 1);
      expect(slot.halted).toBe(false);
      expect(slot.haltReason).toBeUndefined();
      expect(api.statuses.at(-1)).toEqual({ state: "activo", reason: undefined });
      expect(logs.some((l) => l.includes("reanudado"))).toBe(true);

      const [recovered] = await store.list();
      expect(recovered).toMatchObject({ id: incident!.id, status: "abierto", recoveredAt: new Date(time.now()).toISOString() });
      expect(recovered!.recoveryNote).toContain("volvió a pasar");

      // El siguiente ciclo no repite la prueba (acaba de pasar) y trabaja con normalidad.
      api.queue.push(job());
      const round = await runRound([slot], () => {});
      expect(round).toMatchObject({ failed: false, newlyHalted: [], allHalted: false });
      expect(calls.healthCheck).toBe(checksBefore + 1);
      expect(calls.publish).toBe(1);

      // Un fallo posterior es un incidente nuevo, no una repetición del ya recuperado.
      state.failWith = ERROR_CODES.pageChanged;
      time.advance(25 * 3_600_000);
      await runRound([slot], () => {});
      expect((await store.list()).map((i) => i.id)).toEqual([1, 2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const code of [ERROR_CODES.sessionExpired, ERROR_CODES.verificationRequired, ERROR_CODES.browserClosed]) {
    it(`NO se reanuda si el motivo es ${code}: exige a una persona y el robot termina`, async () => {
      const time = clock();
      const { slot, calls, state } = stubSlot(time);
      state.failWith = code;
      const round = await runRound([slot], () => {});
      expect(round.newlyHalted).toEqual([{ slug: "linkedin", reason: code }]);
      expect(isResumable(slot)).toBe(false);
      expect(round.allHalted).toBe(true);
      expect(slot.resume!.lastCheckAt).toBeNull(); // ni siquiera se programó

      state.failWith = null; // aunque el portal "arreglado" pase la prueba, no se comprueba
      const checks = calls.healthCheck;
      time.advance(60 * MIN);
      expect(resumeDue([slot])).toBe(false);
      expect(await runResumeChecks([slot], () => {})).toEqual({ resumed: [], escalated: [] });
      expect(calls.healthCheck).toBe(checks);
      expect(slot.halted).toBe(true);
    });
  }

  it("sin BOT_RESUME_CHECK_MINUTES (0) se conserva el comportamiento anterior: pagina_cambio termina el robot", async () => {
    const time = clock();
    const { slot, calls, state } = stubSlot(time, { resume: false });
    const round = await runRound([slot], () => {});
    expect(round).toMatchObject({ newlyHalted: [{ slug: "linkedin", reason: ERROR_CODES.pageChanged }], allHalted: true });
    state.failWith = null;
    time.advance(60 * MIN);
    const checks = calls.healthCheck;
    expect(await runResumeChecks([slot], () => {})).toEqual({ resumed: [], escalated: [] });
    expect(calls.healthCheck).toBe(checks);
  });

  it("si al comprobar aparece un motivo que exige a una persona, deja de ser reanudable y el robot puede terminar", async () => {
    const time = clock();
    const { slot, state } = stubSlot(time);
    await runRound([slot], () => {});
    expect(allStopped([slot])).toBe(false);
    state.failWith = ERROR_CODES.sessionExpired;
    time.advance(5 * MIN);
    expect(await runResumeChecks([slot], () => {})).toEqual({ resumed: [], escalated: [{ slug: "linkedin", reason: ERROR_CODES.sessionExpired }] });
    expect(slot.haltReason).toBe(ERROR_CODES.sessionExpired);
    expect(allStopped([slot])).toBe(true);
  });

  it("con varios portales el robot no termina mientras alguno pueda reanudarse, y solo cuando todos exijan a una persona", async () => {
    const time = clock();
    const a = stubSlot(time, { slug: "linkedin" });
    const b = stubSlot(time, { slug: "bumeran" });
    const c = stubSlot(time, { slug: "indeed" });
    b.state.failWith = ERROR_CODES.verificationRequired;
    c.state.failWith = ERROR_CODES.sessionExpired;
    const slots = [a.slot, b.slot, c.slot];
    const round = await runRound(slots, () => {});
    expect(round.newlyHalted.map((h) => h.slug)).toEqual(["linkedin", "bumeran", "indeed"]);
    expect(round.allHalted).toBe(false); // linkedin puede volver sola

    a.state.failWith = ERROR_CODES.sessionExpired;
    time.advance(5 * MIN);
    await runResumeChecks(slots, () => {});
    expect(allStopped(slots)).toBe(true);
  });

  it("el estado del robot (orden «estado») muestra los portales detenidos y las reanudaciones", () => {
    const control = new BotControl("demo");
    control.setHalted("linkedin", ERROR_CODES.pageChanged, true);
    control.setHalted("indeed", ERROR_CODES.sessionExpired);
    control.autoResumes = 2;
    const text = control.handle("estado");
    expect(text).toContain("Portales detenidos: linkedin (pagina_cambio, se comprueba solo), indeed (sesion_expirada).");
    expect(text).toContain("Reanudaciones automáticas: 2.");
    control.setHalted("linkedin", null);
    expect(control.handle("estado")).not.toContain("linkedin");
  });

  it("BOT_RESUME_CHECK_MINUTES: 10 por defecto, 0 desactiva, 1–1440 válido y lo demás se rechaza", () => {
    const env = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };
    expect(loadConfig(env).resumeCheckMinutes).toBe(10);
    expect(loadConfig({ ...env, BOT_RESUME_CHECK_MINUTES: "0" }).resumeCheckMinutes).toBe(0);
    expect(loadConfig({ ...env, BOT_RESUME_CHECK_MINUTES: "5" }).resumeCheckMinutes).toBe(5);
    expect(loadConfig({ ...env, BOT_RESUME_CHECK_MINUTES: "1440" }).resumeCheckMinutes).toBe(1440);
    for (const bad of ["0.5", "1441", "-1", "abc"]) {
      expect(() => loadConfig({ ...env, BOT_RESUME_CHECK_MINUTES: bad }), bad).toThrow(/BOT_RESUME_CHECK_MINUTES/);
    }
  });
});

describe("reanudación contra el portal ficticio (Chromium real, un navegador compartido)", () => {
  let browser: Browser;
  let portal: FakePortal;
  let context: BrowserContext;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(() => browser.close(), 180_000); // con el PC cargado el cierre del navegador puede tardar
  beforeEach(async () => {
    portal = await startFakePortal();
    context = await browser.newContext({ acceptDownloads: true });
  });
  afterEach(async () => {
    await context.close();
    await portal.close();
  });

  it("un cambio estructural detiene el portal por pagina_cambio y, restablecido, el robot lo reanuda sin publicar nada en la comprobación", async () => {
    const time = clock();
    const adapter = new FakeLinkedinAdapter(context, portal.url, 3_000);
    const api = new MemoryApi();
    const slot: AdapterSlot = {
      slug: adapter.slug,
      halted: false,
      resume: createResumeSchedule(5, time.now),
      deps: { api, adapter, seen: new MemorySeenStore(), health: createHealthSchedule(24, time.now), log: () => {}, pauseMs: 0, maxJobs: 5 },
    };
    api.queue.push(job());

    portal.mutator.apply("linkedin", "renombrar_campo");
    const first = await runRound([slot], () => {});
    expect(first.newlyHalted).toEqual([{ slug: "linkedin", reason: ERROR_CODES.pageChanged }]);
    expect(first.allHalted).toBe(false);
    expect(portal.jobs.size).toBe(0);

    // Con el portal aún roto la comprobación falla y no publica nada.
    time.advance(5 * MIN);
    expect(await runResumeChecks([slot], () => {})).toEqual({ resumed: [], escalated: [] });
    expect(slot.halted).toBe(true);
    expect(portal.jobs.size).toBe(0);
    expect(api.queue).toHaveLength(1);

    // El mutador restablece el portal: a la siguiente hora el robot lo reanuda y recién entonces trabaja la cola.
    portal.mutator.restore("linkedin");
    time.advance(5 * MIN);
    expect(await runResumeChecks([slot], () => {})).toEqual({ resumed: ["linkedin"], escalated: [] });
    expect(slot.halted).toBe(false);
    expect(portal.jobs.size).toBe(0); // la comprobación no publica
    expect(api.statuses.at(-1)?.state).toBe("activo");

    const second = await runRound([slot], () => {});
    expect(second).toMatchObject({ failed: false, newlyHalted: [], allHalted: false });
    expect(portal.jobs.size).toBe(1);
    expect(api.reports.map((r) => r.body.outcome)).toEqual(["publicada"]);
  });
});
