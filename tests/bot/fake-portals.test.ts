import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeBumeranAdapter } from "../../bot/src/adapters/fake-bumeran";
import { FakeComputrabajoAdapter } from "../../bot/src/adapters/fake-computrabajo";
import { FakeIndeedAdapter } from "../../bot/src/adapters/fake-indeed";
import { FakeLinkedinAdapter } from "../../bot/src/adapters/fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "../../bot/src/adapters/fake-trabajos-diarios";
import { ERROR_CODES } from "../../bot/src/errors";
import { PORTAL_SLUGS, startFakePortal, type FakePortal, type PortalSlug } from "../../bot/src/fake-portal/server";
import { createHealthSchedule, runCycle, type RunnerDeps } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { PortalAdapter } from "../../bot/src/types";
import { makePdf } from "../fixtures/documents";
import { MemoryApi, PUBLICATION_ID, job, vacancy } from "../fixtures/bot";

/** Los cinco adaptadores de los portales ficticios contra el servidor ficticio, con Chromium real. */
const FACTORIES: Record<PortalSlug, (context: BrowserContext, url: string) => PortalAdapter> = {
  linkedin: (context, url) => new FakeLinkedinAdapter(context, url, 3_000),
  bumeran: (context, url) => new FakeBumeranAdapter(context, url, 3_000),
  "trabajos-diarios": (context, url) => new FakeTrabajosDiariosAdapter(context, url, 3_000),
  indeed: (context, url) => new FakeIndeedAdapter(context, url, 3_000),
  computrabajo: (context, url) => new FakeComputrabajoAdapter(context, url, 3_000),
};

let browser: Browser;
let portal: FakePortal;
let pdf: Uint8Array;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  pdf = await makePdf(["Lucía Ramos Ficticia", "Experiencia en SQL."]);
});
afterAll(() => browser.close());
beforeEach(async () => {
  portal = await startFakePortal();
});
afterEach(() => portal.close());

/** El candidato se postula a mano en el lado público del portal ficticio. */
async function applyAsCandidate(slug: PortalSlug, jobId: string, file?: Uint8Array, name = "Lucía Ramos Ficticia") {
  if (slug !== "linkedin") {
    const form = new FormData();
    form.set("nombre", name);
    form.set("correo", "lucia@correo.test");
    form.set("telefono", "999111222");
    if (file) form.set("cv", new Blob([Buffer.from(file)], { type: "application/pdf" }), "cv.pdf");
    const response = await fetch(`${portal.url}/${slug}/empleo/${jobId}/postular`, { method: "POST", body: form });
    expect(await response.text()).toContain("Postulación enviada");
    return;
  }
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${portal.url}/linkedin/empleo/${jobId}`);
    await page.click("#li-postular");
    await page.fill("#ea-nombre", name);
    await page.fill("#ea-correo", "lucia@correo.test");
    await page.fill("#ea-telefono", "999111222");
    await page.click("#ea-siguiente");
    await page.locator("#ea-paso-2").waitFor();
    if (file) await page.setInputFiles("#ea-cv", { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(file) });
    await page.click("#ea-siguiente");
    await page.locator("#ea-paso-3").waitFor();
    await page.click("#ea-siguiente");
    await page.locator("#ea-paso-4").waitFor();
    await page.click("#ea-enviar");
    await page.getByText("Postulación enviada").first().waitFor();
  } finally {
    await context.close();
  }
}

describe.each(PORTAL_SLUGS)("portal ficticio %s", (slug) => {
  let context: BrowserContext;
  let api: MemoryApi;
  let adapter: PortalAdapter;
  let deps: RunnerDeps;

  beforeEach(async () => {
    context = await browser.newContext({ acceptDownloads: true });
    api = new MemoryApi();
    adapter = FACTORIES[slug](context, portal.url);
    deps = { api, adapter, seen: new MemorySeenStore(), log: () => {}, pauseMs: 0, maxJobs: 10 };
  });
  afterEach(() => context.close());

  it("publica, trae un postulante con su CV y retira la oferta", async () => {
    expect(adapter.slug).toBe(slug);
    api.queue.push(job({ vacancy: vacancy({ requirements: [{ description: "Manejo de Excel", priority: "obligatorio" }] }) }));
    await runCycle(deps);

    const published = api.reports[0]!.body;
    if (published.outcome !== "publicada") throw new Error(`no se publicó: ${JSON.stringify(published)}`);
    expect(published.externalUrl).toMatch(/^https:\/\//);
    const created = portal.jobs.get(published.externalId)!;
    expect(created).toMatchObject({ portal: slug, title: "Operario de planta (ficticio)", status: "activa" });
    expect(created.description).toContain("Descripción ficticia");

    await applyAsCandidate(slug, created.id, pdf);
    expect(created.applicants).toHaveLength(1);

    api.activePublications = [
      { publicationId: PUBLICATION_ID, externalId: created.id, externalUrl: published.externalUrl, lastSyncedAt: null },
    ];
    await runCycle(deps);
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]!.applicant).toMatchObject({ fullName: "Lucía Ramos Ficticia", email: "lucia@correo.test", phone: "999111222" });
    expect(Buffer.from(api.sent[0]!.resume.bytes).equals(Buffer.from(pdf))).toBe(true);
    expect(api.synced).toEqual([PUBLICATION_ID]);

    api.queue.push(job({ action: "retirar", externalId: created.id }));
    await runCycle(deps);
    expect(api.reports.at(-1)!.body).toEqual({ outcome: "retirada" });
    expect(created.status).toBe("retirada");

    // Retirar una oferta ya retirada no es un error.
    api.queue.push(job({ action: "retirar", externalId: created.id }));
    await runCycle(deps);
    expect(api.reports.at(-1)!.body).toEqual({ outcome: "retirada" });
  });

  it("sin adjuntar CV, el portal genera un PDF mínimo válido con el nombre del candidato", async () => {
    api.queue.push(job());
    await runCycle(deps);
    const published = api.reports[0]!.body;
    if (published.outcome !== "publicada") throw new Error("no se publicó");
    const created = portal.jobs.get(published.externalId)!;
    await applyAsCandidate(slug, created.id, undefined, "Sin Adjunto Ficticio");
    const generated = created.applicants[0]!.resume;
    expect(Buffer.from(generated).subarray(0, 5).toString()).toBe("%PDF-");
    expect(Buffer.from(generated).toString("latin1")).toContain("Sin Adjunto Ficticio");
  });

  describe("prueba de estructura", () => {
    beforeEach(() => {
      deps.health = createHealthSchedule(24);
    });

    it("con el portal en orden pasa, incluida la pantalla de postulantes de una oferta existente", async () => {
      api.queue.push(job());
      const result = await runCycle(deps);
      expect(result.halted).toBe(false);
      expect(portal.jobs.size).toBe(1);
      await expect(adapter.healthCheck()).resolves.toBeUndefined();
      expect(portal.jobs.size).toBe(1); // la prueba no publica nada
    });

    it("si el portal cambió su formulario, el robot se detiene antes de publicar", async () => {
      portal.setChanged(true, slug);
      api.queue.push(job());
      const result = await runCycle(deps);
      expect(result).toEqual({ halted: true, reason: ERROR_CODES.pageChanged });
      expect(portal.jobs.size).toBe(0);
      expect(api.queue).toHaveLength(1);
    });
  });

  it("ante un CAPTCHA se detiene con verificacion_requerida", async () => {
    portal.setCaptcha(true, slug);
    api.queue.push(job());
    expect(await runCycle(deps)).toEqual({ halted: true, reason: ERROR_CODES.verificationRequired });
    expect(portal.jobs.size).toBe(0);
  });

  it("sin sesión iniciada se detiene con sesion_expirada", async () => {
    portal.setLoggedIn(false, slug);
    api.queue.push(job());
    expect(await runCycle(deps)).toEqual({ halted: true, reason: ERROR_CODES.sessionExpired });
    expect(portal.jobs.size).toBe(0);
  });

  it("si el portal rechaza la oferta reporta publicacion_rechazada", async () => {
    portal.setRejecting(true, slug);
    api.queue.push(job());
    await runCycle(deps);
    expect(api.reports[0]!.body).toEqual({ outcome: "error", errorCode: ERROR_CODES.publicationRejected });
  });
});

describe("asistente de varios pasos", () => {
  let context: BrowserContext;
  beforeEach(async () => {
    context = await browser.newContext();
  });
  afterEach(() => context.close());

  it("LinkedIn: Siguiente/Atrás conservan lo escrito y no se crea nada hasta publicar", async () => {
    const page = await context.newPage();
    await page.goto(`${portal.url}/linkedin/empleos/publicar`);
    await page.locator("#li-paso-1").waitFor();

    // Sin título no avanza.
    await page.click("#li-siguiente");
    await page.locator("#li-paso-1 .err").waitFor();

    await page.fill("#li-titulo", "Analista de datos (ficticio)");
    await page.fill("#li-empresa", "Empresa Demo");
    await page.selectOption("#li-modalidad", "remoto");
    await page.click("#li-siguiente");
    await page.locator("#li-paso-2").waitFor();
    await page.fill("#li-descripcion", "Analiza datos ficticios.");
    await page.fill("#li-pregunta-1", "¿Años de experiencia?");

    await page.click("#li-atras");
    await page.locator("#li-paso-1").waitFor();
    expect(await page.inputValue("#li-titulo")).toBe("Analista de datos (ficticio)");
    expect(await page.inputValue("#li-modalidad")).toBe("remoto");

    await page.click("#li-siguiente");
    await page.locator("#li-paso-2").waitFor();
    expect(await page.inputValue("#li-descripcion")).toBe("Analiza datos ficticios.");
    await page.click("#li-siguiente");
    await page.locator("#li-paso-3").waitFor();
    await page.check("#li-recepcion-plataforma");
    await page.click("#li-siguiente");
    await page.locator("#li-paso-4").waitFor();
    expect(await page.locator("#li-paso-4 dl.resumen").innerText()).toContain("Analista de datos (ficticio)");
    expect(portal.jobs.size).toBe(0);

    await page.click("#li-publicar");
    await page.locator("#li-publicada").waitFor();
    expect(portal.jobs.size).toBe(1);
    expect([...portal.jobs.values()][0]).toMatchObject({
      portal: "linkedin",
      title: "Analista de datos (ficticio)",
      company: "Empresa Demo",
      questions: ["¿Años de experiencia?"],
    });
  });

  it("Bumeran: tres pasos con Volver y publicación al final", async () => {
    const page = await context.newPage();
    await page.goto(`${portal.url}/bumeran/avisos/nuevo`);
    await page.fill("[name=puesto]", "Vendedor (ficticio)");
    await page.click(".btn-continuar");
    await page.locator('[data-step="2"]').waitFor();
    await page.fill("[name=detalle]", "Vende cosas ficticias.");
    await page.click(".btn-volver");
    await page.locator('[data-step="1"]').waitFor();
    expect(await page.inputValue("[name=puesto]")).toBe("Vendedor (ficticio)");
    await page.click(".btn-continuar");
    await page.locator('[data-step="2"]').waitFor();
    expect(await page.inputValue("[name=detalle]")).toBe("Vende cosas ficticias.");
    await page.click(".btn-continuar");
    await page.locator('[data-step="3"]').waitFor();
    await page.check("[name=acepto]");
    await page.click(".btn-publicar-aviso");
    await page.locator(".aviso-titulo").waitFor();
    expect([...portal.jobs.values()][0]).toMatchObject({ portal: "bumeran", title: "Vendedor (ficticio)" });
  });
});

describe("compatibilidad y panel", () => {
  it("el panel, cada sitio y el alias de la raíz responden 200 con el banner", async () => {
    for (const path of ["/", ...PORTAL_SLUGS.map((slug) => `/${slug}`), "/login", "/empleos/nuevo"]) {
      const response = await fetch(`${portal.url}${path}`);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toContain("Portal ficticio · simulación para demostración");
    }
    const dashboard = await (await fetch(`${portal.url}/`)).text();
    for (const slug of PORTAL_SLUGS) expect(dashboard).toContain(`href="/${slug}"`);
  });

  it("/__fake/modo actúa por portal", async () => {
    await fetch(`${portal.url}/__fake/modo?portal=linkedin&captcha=1`, { method: "POST" });
    const linkedin = await (await fetch(`${portal.url}/linkedin/empleos/publicar`)).text();
    const bumeran = await (await fetch(`${portal.url}/bumeran/avisos/nuevo`)).text();
    expect(linkedin).toContain("challenge-dialog");
    expect(bumeran).not.toContain("recaptcha-caja");
    expect((await fetch(`${portal.url}/__fake/modo?portal=nadie`)).status).toBe(400);
  });
});
