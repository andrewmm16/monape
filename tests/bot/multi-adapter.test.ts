import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALIASES, parseAdapterNames } from "../../bot/src/adapters";
import { FakeBumeranAdapter } from "../../bot/src/adapters/fake-bumeran";
import { FakeComputrabajoAdapter } from "../../bot/src/adapters/fake-computrabajo";
import { FakeIndeedAdapter } from "../../bot/src/adapters/fake-indeed";
import { FakeLinkedinAdapter } from "../../bot/src/adapters/fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "../../bot/src/adapters/fake-trabajos-diarios";
import { ERROR_CODES } from "../../bot/src/errors";
import { startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";
import { runRound, type AdapterSlot } from "../../bot/src/round";
import { createHealthSchedule } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { Job } from "../../bot/src/types";
import { MemoryApi, PUBLICATION_ID, job } from "../fixtures/bot";

/** La app simulada con una cola y un estado por portal, como la API real (que recibe el portal en cada solicitud). */
class PerPortalApi extends MemoryApi {
  queues: Record<string, Job[]> = {};
  portalStatuses: { portal: string; state: string; reason?: string }[] = [];

  override async claim(portal?: string): Promise<Job | null> {
    return this.queues[portal ?? ""]?.shift() ?? null;
  }

  override async reportStatus(portal: string, state: "activo" | "necesita_persona", reason?: string): Promise<void> {
    this.portalStatuses.push({ portal, state, reason });
  }
}

describe("BOT_ADAPTER con varios portales", () => {
  it("acepta un nombre, una lista separada por comas y el alias demo, sin repetidos", () => {
    expect(parseAdapterNames("fake")).toEqual(["fake"]);
    expect(parseAdapterNames("demo")).toEqual(ALIASES.demo);
    expect(parseAdapterNames("demo")).toHaveLength(5);
    expect(parseAdapterNames(" fake-linkedin , fake-bumeran,fake-linkedin ")).toEqual(["fake-linkedin", "fake-bumeran"]);
    expect(parseAdapterNames("fake-indeed,demo")).toEqual([
      "fake-indeed",
      "fake-linkedin",
      "fake-bumeran",
      "fake-trabajos-diarios",
      "fake-computrabajo",
    ]);
  });

  it("rechaza nombres que no existen y la lista vacía", () => {
    expect(() => parseAdapterNames("fake-linkedin,nadie")).toThrow(/"nadie" no existe/);
    expect(() => parseAdapterNames("")).toThrow(/no existe/);
  });
});

describe("robot con varios adaptadores y un solo navegador", () => {
  let browser: Browser;
  let portal: FakePortal;
  let context: BrowserContext;
  let api: PerPortalApi;
  let slots: AdapterSlot[];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(() => browser.close());

  beforeEach(async () => {
    portal = await startFakePortal();
    context = await browser.newContext({ acceptDownloads: true });
    api = new PerPortalApi();
    const adapters = [
      new FakeLinkedinAdapter(context, portal.url, 3_000),
      new FakeBumeranAdapter(context, portal.url, 3_000),
      new FakeTrabajosDiariosAdapter(context, portal.url, 3_000),
      new FakeIndeedAdapter(context, portal.url, 3_000),
      new FakeComputrabajoAdapter(context, portal.url, 3_000),
    ];
    slots = adapters.map((adapter) => ({
      slug: adapter.slug,
      halted: false,
      deps: { api, adapter, seen: new MemorySeenStore(), health: createHealthSchedule(24), log: () => {}, pauseMs: 0, maxJobs: 10 },
    }));
    for (const slot of slots) api.queues[slot.slug] = [job({ vacancy: { ...job().vacancy, title: `Oferta ${slot.slug}` } })];
  });
  afterEach(async () => {
    await context.close();
    await portal.close();
  });

  it("una vuelta publica en los cinco portales, cada adaptador con su propia pestaña", async () => {
    const round = await runRound(slots, () => {});
    expect(round).toMatchObject({ failed: false, allHalted: false, newlyHalted: [] });
    expect(round.summary).toBe(slots.map((slot) => `${slot.slug}: correcto`).join("; "));

    expect([...portal.jobs.values()].map((created) => [created.portal, created.title])).toEqual(
      slots.map((slot) => [slot.slug, `Oferta ${slot.slug}`]),
    );
    expect(api.reports.every((report) => report.body.outcome === "publicada")).toBe(true);
    // Un solo contexto, cinco pestañas distintas.
    expect(context.pages().filter((page) => !page.isClosed())).toHaveLength(5);
    // Cada portal informa su propio estado a la app.
    expect(api.portalStatuses.map((status) => status.portal).sort()).toEqual(slots.map((slot) => slot.slug).sort());
  });

  it("si un portal se detiene, se reporta y los demás siguen; termina cuando todos están detenidos", async () => {
    portal.setCaptcha(true, "indeed");
    const first = await runRound(slots, () => {});
    expect(first.newlyHalted).toEqual([{ slug: "indeed", reason: ERROR_CODES.verificationRequired }]);
    expect(first.allHalted).toBe(false);
    expect(first.failed).toBe(false);
    expect(portal.jobs.size).toBe(4);
    expect(api.portalStatuses.find((status) => status.portal === "indeed")).toMatchObject({
      state: "necesita_persona",
      reason: ERROR_CODES.verificationRequired,
    });

    // En la vuelta siguiente el portal detenido ya no se toca y los demás siguen trabajando.
    for (const slug of ["linkedin", "bumeran"]) api.queues[slug] = [job({ publicationId: `${PUBLICATION_ID}-${slug}` })];
    api.queues.indeed = [job()];
    const second = await runRound(slots, () => {});
    expect(second.newlyHalted).toEqual([]);
    expect(second.summary).not.toContain("indeed");
    expect(api.queues.indeed).toHaveLength(1);
    expect(portal.jobs.size).toBe(6);

    portal.setLoggedIn(false);
    for (const slug of ["linkedin", "bumeran", "trabajos-diarios", "computrabajo"]) api.queues[slug] = [job()];
    const last = await runRound(slots, () => {});
    expect(last.newlyHalted.map((halted) => halted.slug)).toEqual(["linkedin", "bumeran", "trabajos-diarios", "computrabajo"]);
    expect(last.allHalted).toBe(true);
  });

  it("si la app no responde, la vuelta se marca fallida pero ningún portal se detiene", async () => {
    api.claim = async () => {
      throw new Error("app caída");
    };
    const round = await runRound(slots, () => {});
    expect(round.failed).toBe(true);
    expect(round.newlyHalted).toEqual([]);
    expect(round.allHalted).toBe(false);
    expect(slots.some((slot) => slot.halted)).toBe(false);
  });
});
