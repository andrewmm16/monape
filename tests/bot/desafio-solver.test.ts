import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FakeLinkedinAdapter } from "../../bot/src/adapters/fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "../../bot/src/adapters/fake-trabajos-diarios";
import { startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";
import type { Desafio } from "../../bot/src/fake-portal/model";
import { runCycle, type RunnerDeps } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { PortalAdapter } from "../../bot/src/types";
import { MemoryApi, job } from "../fixtures/bot";

/**
 * El robot resuelve TODOS los desafíos de verificación con lógica interna, sin servicios
 * externos ni intervención humana: aritmética, texto, slider, casilla, cuadrícula de
 * imágenes, rotar y código por correo (OTP).
 */
let browser: Browser;
let portal: FakePortal;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(() => browser.close());
beforeEach(async () => {
  portal = await startFakePortal();
});
afterEach(() => portal.close());

function makeDeps(adapter: PortalAdapter): { api: MemoryApi; deps: RunnerDeps } {
  const api = new MemoryApi();
  const deps: RunnerDeps = { api, adapter, seen: new MemorySeenStore(), log: () => {}, pauseMs: 0, maxJobs: 10 };
  return { api, deps };
}

describe("portal de una sola pantalla (Trabajos Diarios)", () => {
  let context: BrowserContext;
  let api: MemoryApi;
  let deps: RunnerDeps;

  beforeEach(async () => {
    context = await browser.newContext();
    ({ api, deps } = makeDeps(new FakeTrabajosDiariosAdapter(context, portal.url, 3_000)));
  });
  afterEach(() => context.close());

  /** Pone el desafío, encola un trabajo, corre el ciclo y comprueba que publicó sin detenerse. */
  async function resuelveYPublica(desafio: Desafio): Promise<void> {
    portal.setDesafio(desafio, "trabajos-diarios");
    api.queue.push(job());
    const result = await runCycle(deps);
    expect(result.halted).toBe(false);
    expect(portal.jobs.size).toBe(1);
  }

  it("resuelve una suma leída del DOM y publica", async () => {
    await resuelveYPublica({ tipo: "suma", a: 7, b: 5 });
  });

  it("resuelve un desafío de texto y publica", async () => {
    await resuelveYPublica({ tipo: "texto", a: 0, b: 0, palabra: "AZUL" });
  });

  it("arrastra el deslizador hasta el objetivo y publica", async () => {
    await resuelveYPublica({ tipo: "slider", a: 0, b: 0, objetivo: 200, tolerancia: 6 });
  });

  it("marca la casilla «no soy un robot» y publica", async () => {
    await resuelveYPublica({ tipo: "casilla", a: 0, b: 0 });
  });

  it("selecciona las celdas correctas de la cuadrícula y publica", async () => {
    const celdas = [true, false, true, false, false, false, false, false, true];
    await resuelveYPublica({ tipo: "imagenes", a: 0, b: 0, categoria: "★", celdas });
  });

  it("gira la imagen hasta el ángulo objetivo y publica", async () => {
    await resuelveYPublica({ tipo: "rotar", a: 0, b: 0, angulo: 0, anguloObjetivo: 180 });
  });

  it("lee el código OTP del buzón falso y publica", async () => {
    await resuelveYPublica({ tipo: "otp", a: 0, b: 0, codigo: "246810" });
  });
});

describe("portal con asistente de varios pasos (LinkedIn)", () => {
  it("resuelve el desafío antes del asistente y publica", async () => {
    const context = await browser.newContext();
    try {
      const { api, deps } = makeDeps(new FakeLinkedinAdapter(context, portal.url, 3_000));
      portal.setDesafio({ tipo: "rotar", a: 0, b: 0, angulo: 0, anguloObjetivo: 270 }, "linkedin");
      api.queue.push(job());
      const result = await runCycle(deps);
      expect(result.halted).toBe(false);
      expect(portal.jobs.size).toBe(1);
    } finally {
      await context.close();
    }
  });
});
