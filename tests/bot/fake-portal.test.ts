import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakePortalAdapter } from "../../bot/src/adapters/fake";
import { ERROR_CODES } from "../../bot/src/errors";
import { createHealthSchedule, runCycle, type RunnerDeps } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import { startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";
import { makePdf } from "../fixtures/documents";
import { MemoryApi, PUBLICATION_ID, job } from "../fixtures/bot";

/** El robot completo contra el portal falso, con Chromium real y la app simulada en memoria. */
let browser: Browser;
let portal: FakePortal;
let context: BrowserContext;
let api: MemoryApi;
let deps: RunnerDeps;
let pdf: Uint8Array;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  pdf = await makePdf(["Lucía Ramos Ficticia", "Experiencia en SQL."]);
});
afterAll(() => browser.close());

beforeEach(async () => {
  portal = await startFakePortal();
  context = await browser.newContext({ acceptDownloads: true });
  api = new MemoryApi();
  deps = {
    api,
    adapter: new FakePortalAdapter(context, portal.url, 3_000),
    seen: new MemorySeenStore(),
    log: () => {},
    pauseMs: 0,
    maxJobs: 10,
  };
});
afterEach(async () => {
  await context.close();
  await portal.close();
});

describe("robot contra el portal falso", () => {
  it("publica, trae postulantes con su CV y retira la oferta", async () => {
    api.queue.push(job());
    await runCycle(deps);

    const published = api.reports[0]!.body;
    expect(published.outcome).toBe("publicada");
    if (published.outcome !== "publicada") return;
    const created = portal.jobs.get(published.externalId)!;
    expect(created.title).toBe("Operario de planta (ficticio)");
    expect(published.externalUrl).toBe(`https://portal-falso.test/empleos/${created.id}`);

    created.applicants.push({ id: "c1", fullName: "Lucía Ramos Ficticia", email: "lucia@correo.test", phone: "999111222", resume: pdf });
    api.activePublications = [
      { publicationId: PUBLICATION_ID, externalId: created.id, externalUrl: published.externalUrl, lastSyncedAt: null },
    ];
    await runCycle(deps);

    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]!.applicant).toMatchObject({ externalId: "c1", fullName: "Lucía Ramos Ficticia", email: "lucia@correo.test", phone: "999111222" });
    expect(Buffer.from(api.sent[0]!.resume.bytes).subarray(0, 4).toString()).toBe("%PDF");
    expect(api.synced).toEqual([PUBLICATION_ID]);

    api.queue.push(job({ action: "retirar", externalId: created.id }));
    await runCycle(deps);
    expect(api.reports.at(-1)!.body).toEqual({ outcome: "retirada" });
    expect(created.status).toBe("retirada");
  });

  it("una oferta sin postulantes se revisa sin error y queda marcada como revisada", async () => {
    api.queue.push(job());
    await runCycle(deps);
    const published = api.reports[0]!.body;
    if (published.outcome !== "publicada") throw new Error("no se publicó");
    api.activePublications = [
      { publicationId: PUBLICATION_ID, externalId: published.externalId, externalUrl: published.externalUrl, lastSyncedAt: null },
    ];
    const result = await runCycle(deps);
    expect(result.halted).toBe(false);
    expect(api.sent).toHaveLength(0);
    expect(api.synced).toEqual([PUBLICATION_ID]);
  });

  describe("prueba diaria de estructura", () => {
    beforeEach(() => {
      deps.health = createHealthSchedule(24);
    });

    it("con el portal en orden pasa y el robot sigue con su trabajo", async () => {
      api.queue.push(job());
      const result = await runCycle(deps);
      expect(result.halted).toBe(false);
      expect(portal.jobs.size).toBe(1);
    });

    it("si el portal cambió su formulario, el robot se detiene antes de publicar y avisa", async () => {
      portal.setChanged(true);
      api.queue.push(job());
      const result = await runCycle(deps);
      expect(result).toEqual({ halted: true, reason: ERROR_CODES.pageChanged });
      expect(portal.jobs.size).toBe(0);
      expect(api.queue).toHaveLength(1);
      expect(api.statuses.at(-1)).toEqual({ state: "necesita_persona", reason: ERROR_CODES.pageChanged });
    });

    it("ante un CAPTCHA o sin sesión se detiene sin publicar", async () => {
      portal.setCaptcha(true);
      api.queue.push(job());
      expect(await runCycle(deps)).toEqual({ halted: true, reason: ERROR_CODES.verificationRequired });
      portal.setCaptcha(false);
      portal.setLoggedIn(false);
      deps.health = createHealthSchedule(24);
      expect(await runCycle(deps)).toEqual({ halted: true, reason: ERROR_CODES.sessionExpired });
      expect(portal.jobs.size).toBe(0);
    });
  });

  it("sin sesión iniciada se detiene con sesion_expirada", async () => {
    portal.setLoggedIn(false);
    api.queue.push(job());
    const result = await runCycle(deps);
    expect(result).toEqual({ halted: true, reason: ERROR_CODES.sessionExpired });
    expect(portal.jobs.size).toBe(0);
  });

  it("ante un CAPTCHA se detiene con verificacion_requerida y no intenta resolverlo", async () => {
    portal.setCaptcha(true);
    api.queue.push(job());
    const result = await runCycle(deps);
    expect(result).toEqual({ halted: true, reason: ERROR_CODES.verificationRequired });
    expect(api.reports[0]!.body).toEqual({ outcome: "error", errorCode: ERROR_CODES.verificationRequired });
  });

  it("si el portal cambia su formulario reporta pagina_cambio", async () => {
    portal.setChanged(true);
    api.queue.push(job());
    await runCycle(deps);
    expect(api.reports[0]!.body).toEqual({ outcome: "error", errorCode: ERROR_CODES.pageChanged });
  });

  it("si el portal rechaza la oferta reporta publicacion_rechazada", async () => {
    portal.setRejecting(true);
    api.queue.push(job());
    await runCycle(deps);
    expect(api.reports[0]!.body).toEqual({ outcome: "error", errorCode: ERROR_CODES.publicationRejected });
  });
});
