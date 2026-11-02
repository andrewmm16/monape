import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeBumeranAdapter } from "../../bot/src/adapters/fake-bumeran";
import { FakeComputrabajoAdapter } from "../../bot/src/adapters/fake-computrabajo";
import { FakeIndeedAdapter } from "../../bot/src/adapters/fake-indeed";
import { FakeLinkedinAdapter } from "../../bot/src/adapters/fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "../../bot/src/adapters/fake-trabajos-diarios";
import { ERROR_CODES, errorCodeOf } from "../../bot/src/errors";
import { MUTACIONES, type Mutacion, type PasoRobot } from "../../bot/src/fake-portal/mutations";
import { PORTAL_SLUGS, startFakePortal, type FakePortal, type PortalSlug } from "../../bot/src/fake-portal/server";
import type { ActivePublication, PortalAdapter } from "../../bot/src/types";
import { makePdf } from "../fixtures/documents";
import { PUBLICATION_ID, vacancy } from "../fixtures/bot";

/**
 * Cada cambio del catálogo contra el adaptador de su portal, con Chromium real:
 * los estructurales deben romper el paso esperado con `pagina_cambio` y, tras
 * restablecer, todo vuelve a funcionar; los cosméticos no deben romper nada.
 */
const FACTORIES: Record<PortalSlug, (context: BrowserContext, url: string) => PortalAdapter> = {
  linkedin: (context, url) => new FakeLinkedinAdapter(context, url, 2_000),
  bumeran: (context, url) => new FakeBumeranAdapter(context, url, 2_000),
  "trabajos-diarios": (context, url) => new FakeTrabajosDiariosAdapter(context, url, 2_000),
  indeed: (context, url) => new FakeIndeedAdapter(context, url, 2_000),
  computrabajo: (context, url) => new FakeComputrabajoAdapter(context, url, 2_000),
};

const SEED_ID = "fp-semilla";

let browser: Browser;
let portal: FakePortal;
let context: BrowserContext;
let pdf: Uint8Array;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  pdf = await makePdf(["Lucía Ramos Ficticia", "Experiencia en SQL."]);
});
afterAll(() => browser.close());
beforeEach(async () => {
  portal = await startFakePortal();
  context = await browser.newContext({ acceptDownloads: true });
});
afterEach(async () => {
  await context.close();
  await portal.close();
});

/** Una oferta ya publicada con un postulante, para las pantallas que solo existen con una oferta. */
function seedJob(slug: PortalSlug) {
  const job = {
    id: SEED_ID,
    portal: slug,
    title: "Oferta existente (ficticia)",
    description: "Descripción ficticia.",
    status: "activa" as const,
    createdAt: new Date().toISOString(),
    applicants: [{ id: "c-semilla", fullName: "Lucía Ramos Ficticia", email: "lucia@correo.test", phone: "999111222", resume: pdf }],
  };
  portal.jobs.set(SEED_ID, job);
  return job;
}

const publication: ActivePublication = { publicationId: PUBLICATION_ID, externalId: SEED_ID, externalUrl: null, lastSyncedAt: null };

/** Ejecuta un paso del robot y devuelve «ok» o el código de error. */
async function outcome(adapter: PortalAdapter, paso: PasoRobot): Promise<string> {
  try {
    switch (paso) {
      case "healthCheck":
        await adapter.healthCheck();
        break;
      case "publish":
        await adapter.publish(vacancy());
        break;
      case "retirar":
        await adapter.withdraw(SEED_ID);
        break;
      case "postulantes":
        await adapter.listApplicants(publication);
        break;
      case "cv": {
        const [applicant] = await adapter.listApplicants(publication);
        const resume = await adapter.downloadResume(publication, applicant!);
        expect(Buffer.from(resume.bytes).subarray(0, 4).toString()).toBe("%PDF");
        break;
      }
    }
    return "ok";
  } catch (error) {
    if (error instanceof Error && error.name === "AssertionError") throw error;
    return errorCodeOf(error);
  }
}

const pairs = (tipo: Mutacion["tipo"]) =>
  MUTACIONES.filter((m) => m.tipo === tipo).flatMap((m) => m.portales.map((slug) => [m.id, slug] as const));

describe("el catálogo", () => {
  it("cada estructural aplica a al menos un portal y declara qué paso del robot debe notarlo", () => {
    const structural = MUTACIONES.filter((m) => m.tipo === "estructural");
    expect(structural.map((m) => m.id)).toEqual([
      "renombrar_campo",
      "texto_boton",
      "boton_en_menu",
      "paso_extra",
      "reordenar_pasos",
      "campo_obligatorio",
      "campo_a_lista",
      "aviso_cookies",
      "paginacion_postulantes",
      "enlace_cv",
    ]);
    for (const m of structural) {
      expect(m.portales.length, m.id).toBeGreaterThan(0);
      for (const slug of m.portales) expect(m.esperado(slug).length, `${m.id} en ${slug}`).toBeGreaterThan(0);
    }
    // Solo LinkedIn y Bumeran tienen asistente.
    expect(MUTACIONES.find((m) => m.id === "paso_extra")!.portales).toEqual(["linkedin", "bumeran"]);
    expect(MUTACIONES.filter((m) => m.tipo === "cosmetica").every((m) => m.portales.length === PORTAL_SLUGS.length && m.esperado("indeed").length === 0)).toBe(true);
  });
});

describe("cambios estructurales", () => {
  it.each(pairs("estructural"))("%s en %s: el adaptador falla con pagina_cambio y tras restablecer vuelve a funcionar", async (id, slug) => {
    const mutacion = MUTACIONES.find((m) => m.id === id)!;
    const adapter = FACTORIES[slug](context, portal.url);
    const job = seedJob(slug);
    const esperado = mutacion.esperado(slug);

    // Antes del cambio todo funciona.
    for (const paso of esperado) expect(await outcome(adapter, paso), `antes: ${paso}`).toBe("ok");
    job.status = "activa";

    const cambio = portal.mutator.apply(slug, id);
    expect(cambio).toMatchObject({ portal: slug, mutacion: id, tipo: "estructural", estado: "activa", esperado });
    for (const paso of esperado) expect(await outcome(adapter, paso), `con el cambio: ${paso}`).toBe(ERROR_CODES.pageChanged);

    // «Restablecer» (el mismo enlace que usa el panel) devuelve el original y marca el cambio.
    await fetch(`${portal.url}/__fake/modo?portal=${slug}&restablecer=1`, { method: "POST" });
    expect(portal.mutator.state().cambios[0]).toMatchObject({ id: cambio.id, estado: "restablecida" });
    job.status = "activa";
    for (const paso of esperado) expect(await outcome(adapter, paso), `restablecido: ${paso}`).toBe("ok");
  });

  it("un cambio en un portal no afecta a los demás", async () => {
    portal.mutator.apply("linkedin", "boton_en_menu");
    portal.mutator.apply("indeed", "campo_obligatorio");
    for (const slug of ["bumeran", "trabajos-diarios", "computrabajo"] as const) {
      expect(await outcome(FACTORIES[slug](context, portal.url), "healthCheck"), slug).toBe("ok");
    }
    expect(await outcome(FACTORIES.linkedin(context, portal.url), "healthCheck")).toBe(ERROR_CODES.pageChanged);
  });
});

describe("la prueba de estructura no deja rastro y avisa de lo que no cubre", () => {
  it.each(PORTAL_SLUGS)("%s: sin ofertas pasa, no crea nada, cierra su pestaña y deja los pasos sin cubrir", async (slug) => {
    const adapter = FACTORIES[slug](context, portal.url);
    expect(await outcome(adapter, "healthCheck")).toBe("ok");
    expect(portal.jobs.size).toBe(0);
    expect(context.pages().filter((p) => !p.isClosed())).toHaveLength(1); // solo la pestaña del adaptador
    expect(adapter.healthCheckGaps?.()).toEqual(
      slug === "trabajos-diarios"
        ? ["lista de candidatos", "enlace al CV"]
        : ["lista de candidatos", "enlace al CV", "botón de retirar"],
    );
  });

  it.each(PORTAL_SLUGS)("%s: con una oferta activa y postulante cubre el CV y el retiro sin publicar ni retirar nada", async (slug) => {
    const adapter = FACTORIES[slug](context, portal.url);
    const job = seedJob(slug);
    expect(await outcome(adapter, "healthCheck")).toBe("ok");
    expect(portal.jobs.size).toBe(1);
    expect(job.status).toBe("activa");
    expect(adapter.healthCheckGaps?.()).toEqual([]);
  });
});

describe("cambios cosméticos", () => {
  it.each(PORTAL_SLUGS)("%s: ningún cosmético rompe publicar, la prueba de estructura ni los postulantes", async (slug) => {
    const adapter = FACTORIES[slug](context, portal.url);
    seedJob(slug);
    for (const m of MUTACIONES.filter((m) => m.tipo === "cosmetica")) {
      portal.mutator.apply(slug, m.id);
      for (const paso of ["healthCheck", "publish", "postulantes", "cv"] as const) expect(await outcome(adapter, paso), `${m.id}: ${paso}`).toBe("ok");
    }
    // Solo el último cosmético sigue activo: cada uno reemplaza al anterior.
    expect(portal.mutator.state().activas).toHaveLength(1);
  });
});
