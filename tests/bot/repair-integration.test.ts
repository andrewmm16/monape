import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeTrabajosDiariosAdapter } from "../../bot/src/adapters/fake-trabajos-diarios";
import { ERROR_CODES, PortalError, errorCodeOf } from "../../bot/src/errors";
import { startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";
import { FileIncidentStore } from "../../bot/src/incidents";
import { BotControl } from "../../bot/src/notify/control";
import { createIncomingHandler } from "../../bot/src/notify/incoming";
import { createRepairService } from "../../bot/src/repair";
import type { Complete } from "../../bot/src/repair/client";
import { ProposalStore } from "../../bot/src/repair/proposals";
import { TrialQueue, rehearseOnAdapter } from "../../bot/src/repair/trial";
import { createResumeSchedule, runResumeChecks, type AdapterSlot } from "../../bot/src/round";
import { createHealthSchedule, runCycle } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import { configureSelectorState, getBook, getOverride, readTolerances, resetSelectorState, tolerante, trialsActive, type EntradaLibro } from "../../bot/src/selectors";
import type { PortalAdapter } from "../../bot/src/types";
import { MemoryApi, vacancy } from "../fixtures/bot";

/**
 * Reparación asistida de punta a punta contra el portal ficticio (Chromium real) con un modelo SIMULADO:
 * el portal cambia, el robot falla, llega una propuesta, «sí N» la aplica y el robot lo supera.
 *
 * Nota: con el libro actual, `renombrar_campo` ya lo absorbe la tolerancia (el campo se halla por su
 * etiqueta). Para ejercitar la reparación se estrecha el campo del título a «solo selector por defecto»
 * (sin alternativas), que es justo el caso de un portal real cuyo cambio ninguna alternativa cubre.
 */
const SLUG = "trabajos-diarios";
let browser: Browser;
let portal: FakePortal;
let context: BrowserContext;
let dir: string;
let originalEntry: EntradaLibro;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(() => browser.close());
beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "reparacion-int-"));
  configureSelectorState({ overridesFile: path.join(dir, "selectores.json"), tolerancesFile: path.join(dir, "tolerancias.json") });
  originalEntry = getBook(SLUG)!.campo_titulo!;
  getBook(SLUG)!.campo_titulo = tolerante(originalEntry.descripcion, originalEntry.selector, []);
  portal = await startFakePortal();
  context = await browser.newContext();
});
afterEach(async () => {
  getBook(SLUG)!.campo_titulo = originalEntry;
  await context.close();
  await portal.close();
  resetSelectorState();
  rmSync(dir, { recursive: true, force: true });
});

/** El robot vacía la cola de ensayos en su turno; aquí se hace mientras la tarea pendiente avanza. */
async function pump(task: Promise<unknown>, queue: TrialQueue): Promise<void> {
  let done = false;
  const tracked = task.finally(() => void (done = true));
  while (!done) {
    await queue.drain();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await tracked;
}

const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error);

describe("reparación asistida con el portal ficticio", () => {
  it("renombrar_campo falla → propuesta simulada → «sí N» → el robot lo supera (y queda verificado)", async () => {
    const adapter = new FakeTrabajosDiariosAdapter(context, portal.url, 2_000);
    const sent: string[] = [];
    const logs: string[] = [];
    const prompts: string[] = [];
    // El «modelo» simulado se equivoca en el 1.er intento y corrige en el 2.º, ya con el error del ensayo en el prompt.
    const selectors = ["#titulo-equivocado", "#titulo-v2"];
    const complete = vi.fn<Complete>(async ({ prompt }) => {
      prompts.push(prompt);
      return {
        text: JSON.stringify({ sin_propuesta: false, clave: "campo_titulo", selector: selectors.shift(), confianza: "alta", razon: "El campo del título pasó a tener el id titulo-v2." }),
        stopReason: "end_turn",
        tokensEntrada: 800,
        tokensSalida: 60,
      };
    });
    const repair = createRepairService({
      complete,
      model: "claude-sonnet-5-5",
      maxPerDay: 10,
      verifyMinutes: 30,
      maxAttempts: 3,
      rehearse: (_portal, clave, selector, step) => trials.enqueue(() => rehearseOnAdapter(adapter, clave, selector, step)),
      store: new ProposalStore(path.join(dir, "propuestas")),
      notify: async (text) => void sent.push(text),
      log: (message) => void logs.push(message),
    });
    const trials = new TrialQueue();
    const incidents = new FileIncidentStore(path.join(dir, "incidentes"), () => {}, (incident) => repair.handleNewIncident(incident));
    const handle = createIncomingHandler(new BotControl("fake-trabajos-diarios"), incidents, repair);

    // 1. El portal cambia y el robot falla.
    portal.mutator.apply(SLUG, "renombrar_campo");
    const error = await failure(adapter.healthCheck());
    expect(errorCodeOf(error)).toBe(ERROR_CODES.pageChanged);
    expect(String(error instanceof Error ? error.message : error)).toContain("[campo_titulo]");
    expect(readTolerances()).toEqual([]); // sin alternativas no hay tolerancia posible

    // 2. Queda el incidente (con el esquema REAL de la pantalla donde falló) y llega la propuesta.
    await pump(incidents.record({ portal: adapter.slug, step: "prueba_estructura", error, captureStructure: () => adapter.captureStructure() }), trials);
    const [incident] = await incidents.list();
    expect(incident).toMatchObject({ id: 1, reparable: true, portal: SLUG });
    expect(incident!.structure).toContain("titulo-v2");
    // Primer intento: el selector equivocado se PRUEBA en el portal real, falla, y el modelo corrige con el error del ensayo.
    expect(complete).toHaveBeenCalledTimes(2);
    expect(prompts[1]).toContain("«#titulo-equivocado»");
    expect(prompts[1]).toContain("NO pasó");
    expect(prompts[1]).toContain("[campo_titulo]");
    expect(trialsActive()).toBe(0); // ningún override temporal queda aplicado
    expect(await new ProposalStore(path.join(dir, "propuestas")).get(1)).toMatchObject({ probada: true, intentos: 2, selector: "#titulo-v2" });
    expect(prompts[0]).toContain("titulo-v2");
    expect(prompts[0]).toContain("campo_titulo");
    expect(sent).toEqual([
      "Propuesta PROBADA para #1: usar «#titulo-v2» como campo_titulo; la prueba de estructura pasó con este cambio. Responda «sí 1» para aplicarla o «no 1» para rechazarla.",
    ]);
    expect(getOverride(SLUG, "campo_titulo")).toBeUndefined();

    // 3. Sin aprobar, el robot sigue fallando.
    expect(errorCodeOf(await failure(adapter.publish(vacancy())))).toBe(ERROR_CODES.pageChanged);

    // 4. «sí 1» aplica el override; la comprobación automática (runResumeChecks) lo verifica.
    const reply = await handle({ kind: "decision", decision: "aprobado", id: 1 });
    expect(reply).toContain("comprobación automática");
    expect(getOverride(SLUG, "campo_titulo")).toMatchObject({ selector: "#titulo-v2", incidenteId: 1 });

    const slot: AdapterSlot = {
      slug: SLUG,
      halted: true,
      haltReason: ERROR_CODES.pageChanged,
      resume: createResumeSchedule(5),
      deps: { api: new MemoryApi(), adapter, seen: new MemorySeenStore(), log: () => {}, pauseMs: 0, maxJobs: 1 },
    };
    const result = await runResumeChecks([slot], () => {}, () => false, (slug, ok, startedAt) => repair.onHealthResult(slug, ok, startedAt));
    expect(result.resumed).toEqual([SLUG]);
    expect(sent.at(-1)).toContain("Reparación aplicada y verificada");
    expect(await new ProposalStore(path.join(dir, "propuestas")).get(1)).toMatchObject({ estado: "aplicada", verificadaEn: expect.any(String), tokensEntrada: 1600, tokensSalida: 120 });

    // 5. Con el selector aprobado, publicar funciona de verdad.
    const published = await adapter.publish(vacancy());
    expect(portal.jobs.get(published.externalId)?.title).toBe(vacancy().title);
  });

  it("si el selector propuesto no arregla el portal, la comprobación falla y se REVIERTE sola", async () => {
    const adapter = new FakeTrabajosDiariosAdapter(context, portal.url, 2_000);
    const sent: string[] = [];
    const complete: Complete = async () => ({
      text: JSON.stringify({ sin_propuesta: false, clave: "campo_titulo", selector: "#no-es-este", confianza: "baja", razon: "Conjetura." }),
      stopReason: "end_turn",
      tokensEntrada: 1,
      tokensSalida: 1,
    });
    const repair = createRepairService({
      complete,
      model: "claude-sonnet-5-5",
      maxPerDay: 10,
      verifyMinutes: 30,
      maxAttempts: 1,
      // Simula un portal que cambió entre la prueba y la aprobación: el ensayo «pasó», pero el selector no sirve.
      rehearse: async () => ({ resultado: "paso", mensaje: "ok" }),
      store: new ProposalStore(path.join(dir, "propuestas")),
      notify: async (text) => void sent.push(text),
      log: () => {},
    });
    const incidents = new FileIncidentStore(path.join(dir, "incidentes"), () => {}, (incident) => repair.handleNewIncident(incident));
    const handle = createIncomingHandler(new BotControl("fake-trabajos-diarios"), incidents, repair);

    portal.mutator.apply(SLUG, "renombrar_campo");
    const error = await failure(adapter.healthCheck());
    await incidents.record({ portal: adapter.slug, step: "prueba_estructura", error, captureStructure: () => adapter.captureStructure() });
    await handle({ kind: "decision", decision: "aprobado", id: 1 });
    expect(getOverride(SLUG, "campo_titulo")).toMatchObject({ selector: "#no-es-este" });

    const slot: AdapterSlot = {
      slug: SLUG,
      halted: true,
      haltReason: ERROR_CODES.pageChanged,
      resume: createResumeSchedule(5),
      deps: { api: new MemoryApi(), adapter, seen: new MemorySeenStore(), log: () => {}, pauseMs: 0, maxJobs: 1 },
    };
    const result = await runResumeChecks([slot], () => {}, () => false, (slug, ok, startedAt) => repair.onHealthResult(slug, ok, startedAt));
    expect(result.resumed).toEqual([]);
    expect(getOverride(SLUG, "campo_titulo")).toBeUndefined();
    expect(await new ProposalStore(path.join(dir, "propuestas")).get(1)).toMatchObject({ estado: "revertida" });
    expect(sent.at(-1)).toContain("se revirtió");
  });
});

describe("avisos del resultado de la prueba de estructura", () => {
  const stub = (failWith: string | null): PortalAdapter => ({
    slug: "linkedin",
    healthCheck: async () => {
      if (failWith) throw new PortalError(failWith, "x");
    },
    publish: async () => ({ externalId: "1", externalUrl: "https://x.test/1" }),
    withdraw: async () => {},
    listApplicants: async () => [],
    downloadResume: async () => ({ filename: "cv.pdf", bytes: new Uint8Array() }),
    close: async () => {},
  });
  const slotFor = (adapter: PortalAdapter): AdapterSlot => ({
    slug: "linkedin",
    halted: true,
    haltReason: ERROR_CODES.pageChanged,
    resume: createResumeSchedule(5),
    deps: { api: new MemoryApi(), adapter, seen: new MemorySeenStore(), log: () => {}, pauseMs: 0, maxJobs: 1 },
  });

  it("runResumeChecks avisa pasa/falla, y no avisa cuando el fallo exige a una persona", async () => {
    const seen: boolean[] = [];
    const onCheck = (_slug: string, ok: boolean) => void seen.push(ok);
    await runResumeChecks([slotFor(stub(ERROR_CODES.pageChanged))], () => {}, () => false, onCheck);
    await runResumeChecks([slotFor(stub(null))], () => {}, () => false, onCheck);
    await runResumeChecks([slotFor(stub(ERROR_CODES.sessionExpired))], () => {}, () => false, onCheck);
    expect(seen).toEqual([false, true]);
    // Un aviso que lanza no tumba la comprobación.
    const slot = slotFor(stub(null));
    await expect(runResumeChecks([slot], () => {}, () => false, () => Promise.reject(new Error("falló")))).resolves.toMatchObject({ resumed: ["linkedin"] });
  });

  it("runCycle avisa el resultado de la prueba periódica", async () => {
    const seen: boolean[] = [];
    const base = { api: new MemoryApi(), seen: new MemorySeenStore(), log: () => {}, pauseMs: 0, maxJobs: 1, onHealthCheck: (ok: boolean) => void seen.push(ok) };
    await runCycle({ ...base, adapter: stub(null), health: createHealthSchedule(24) });
    await runCycle({ ...base, adapter: stub(ERROR_CODES.pageChanged), health: createHealthSchedule(24) });
    await runCycle({ ...base, adapter: stub(ERROR_CODES.sessionExpired), health: createHealthSchedule(24) });
    expect(seen).toEqual([true, false]);
  });
});
