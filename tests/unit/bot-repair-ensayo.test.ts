import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileIncidentStore, type Incident } from "../../bot/src/incidents";
import { BotControl } from "../../bot/src/notify/control";
import { createIncomingHandler } from "../../bot/src/notify/incoming";
import { createRepairService } from "../../bot/src/repair";
import type { Complete, CompleteResult } from "../../bot/src/repair/client";
import { ProposalStore } from "../../bot/src/repair/proposals";
import { TrialQueue, rehearseOnAdapter, stepCovered, type EnsayoResult } from "../../bot/src/repair/trial";
import { activeSelector, configureSelectorState, getOverride, registerBook, resetSelectorState, tolerante, trialsActive } from "../../bot/src/selectors";
import type { PortalAdapter } from "../../bot/src/types";

// Ensayo de las propuestas antes de enviarlas. Nunca se llama a la API real: `complete` es simulado.
const PORTAL = "t-ensayo";
registerBook(PORTAL, { campo_titulo: tolerante("Campo del título", "#titulo", [{ etiqueta: ["Título"] }]) });

let dir: string;
let clock: number;
const now = () => new Date(clock);
const logs: string[] = [];
const sent: string[] = [];
const PASS: EnsayoResult = { resultado: "paso", mensaje: "la prueba de estructura pasó con el selector en ensayo" };
const FAIL: EnsayoResult = { resultado: "fallo", mensaje: "falta «Campo del título» [campo_titulo]", estructura: '{"fresco":"titulo-v2"}' };

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ensayo-"));
  configureSelectorState({ overridesFile: path.join(dir, "selectores.json"), tolerancesFile: path.join(dir, "tolerancias.json") });
  clock = Date.parse("2026-03-02T10:00:00Z");
  logs.length = 0;
  sent.length = 0;
});
afterEach(async () => {
  resetSelectorState();
  await rm(dir, { recursive: true, force: true });
});

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 1,
  createdAt: "2026-03-02T09:59:00.000Z",
  lastSeenAt: "2026-03-02T09:59:00.000Z",
  occurrences: 1,
  portal: PORTAL,
  step: "prueba_estructura",
  errorCode: "pagina_cambio",
  message: "falta «Campo del título» [campo_titulo]",
  reparable: true,
  structure: '{"fields":[{"id":"titulo-v2"}],"buttons":[]}',
  status: "abierto",
  ...over,
});

const answer = (selector: string): CompleteResult => ({
  text: JSON.stringify({ sin_propuesta: false, clave: "campo_titulo", selector, confianza: "alta", razon: "Cambió el id." }),
  stopReason: "end_turn",
  tokensEntrada: 100,
  tokensSalida: 10,
});

function setup(selectors: string[], rehearse: (portal: string, clave: string, selector: string, step: string) => Promise<EnsayoResult>, extra: { maxPerDay?: number; maxAttempts?: number } = {}) {
  const queue = [...selectors];
  let last = "#sin-mas";
  const complete = vi.fn<Complete>(async () => answer((last = queue.shift() ?? last)));
  const rehearseMock = vi.fn(rehearse);
  const store = new ProposalStore(path.join(dir, "propuestas"), now);
  const repair = createRepairService({
    complete,
    model: "claude-sonnet-5-5",
    maxPerDay: extra.maxPerDay ?? 10,
    verifyMinutes: 30,
    maxAttempts: extra.maxAttempts ?? 3,
    rehearse: rehearseMock,
    store,
    notify: async (text) => void sent.push(text),
    log: (m) => void logs.push(m),
    now,
  });
  return { complete, rehearse: rehearseMock, store, repair };
}

describe("ensayo antes de proponer", () => {
  it("pasa a la primera: se prueba con (portal, clave, selector, paso) y se avisa «PROBADA»", async () => {
    const { repair, complete, rehearse, store } = setup(["#titulo-v2"], async () => PASS);
    await repair.handleNewIncident(incident());
    expect(rehearse).toHaveBeenCalledWith(PORTAL, "campo_titulo", "#titulo-v2", "prueba_estructura");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(await store.get(1)).toMatchObject({ probada: true, intentos: 1, ensayo: { resultado: "paso" } });
    expect(sent).toEqual([
      "Propuesta PROBADA para #1: usar «#titulo-v2» como campo_titulo; la prueba de estructura pasó con este cambio. Responda «sí 1» para aplicarla o «no 1» para rechazarla.",
    ]);
  });

  it("falla y corrige en el 2.º intento: el modelo recibe el selector probado y el error del ensayo; se suman los tokens", async () => {
    const { repair, complete, store } = setup(["#malo", "#titulo-v2"], async (_p, _c, selector) => (selector === "#malo" ? FAIL : PASS));
    await repair.handleNewIncident(incident());
    expect(complete).toHaveBeenCalledTimes(2);
    const second = complete.mock.calls[1]![0].prompt;
    for (const part of ["Intento 2 de 3", "«#malo»", "NO pasó", "falta «Campo del título» [campo_titulo]", "titulo-v2"]) expect(second).toContain(part);
    expect(complete.mock.calls[0]![0].prompt).not.toContain("Intento 2");
    expect(await store.get(1)).toMatchObject({ selector: "#titulo-v2", probada: true, intentos: 2, tokensEntrada: 200, tokensSalida: 20 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("PROBADA");
  });

  it("agota los intentos: avisa con honestidad, guarda la última solo como consulta y «sí N» no la aplica", async () => {
    const { repair, complete, store } = setup(["#a1", "#a2", "#a3"], async () => FAIL);
    await repair.handleNewIncident(incident());
    expect(complete).toHaveBeenCalledTimes(3);
    expect(sent).toEqual(["No encontré una solución probada para #1 tras 3 intentos; hace falta revisar el adaptador."]);
    expect(await store.get(1)).toMatchObject({ probada: false, intentos: 3, selector: "#a3", estado: "propuesta", ensayo: { resultado: "fallo" } });
    expect(await repair.pending(1)).toBeNull();
    expect(await repair.apply(1)).toMatchObject({ ok: false });

    const incidents = new FileIncidentStore(path.join(dir, "incidentes"), () => {});
    await incidents.record({ portal: PORTAL, step: "publicar", error: new Error("x") });
    const handle = createIncomingHandler(new BotControl("fake"), incidents, repair);
    expect(await handle({ kind: "decision", decision: "aprobado", id: 1 })).toContain("solo como constancia"); // sin propuesta aplicable: como siempre
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
  });

  it("si el modelo repite el selector que ya falló, se detienen los intentos", async () => {
    const { repair, complete } = setup(["#igual"], async () => FAIL);
    await repair.handleNewIncident(incident());
    expect(complete).toHaveBeenCalledTimes(2);
    expect(logs.join("\n")).toContain("repitió el selector");
    expect(sent[0]).toContain("tras 2 intentos;");
  });

  it("el límite diario cuenta los reintentos", async () => {
    const { repair, complete } = setup(["#a1", "#a2", "#a3"], async () => FAIL, { maxPerDay: 2 });
    await repair.handleNewIncident(incident());
    expect(complete).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes("límite diario (2)"))).toBe(true);
    expect(sent).toEqual(["No encontré una solución probada para #1 tras 2 intentos; hace falta revisar el adaptador."]);
    await repair.handleNewIncident(incident({ id: 2 }));
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("paso que la prueba de estructura no cubre: «SIN PROBAR», y «sí N» sí la aplica (con verificación posterior)", async () => {
    const { repair, store } = setup(["#titulo-v2"], async () => ({ resultado: "no_cubierto", mensaje: "no cubre este paso" }));
    await repair.handleNewIncident(incident({ step: "descargar_cv" }));
    expect(sent[0]).toContain("Propuesta SIN PROBAR (la prueba de estructura no cubre este paso) para #1");
    expect(sent[0]).toContain("La verificación ocurrirá tras aprobarla");
    expect(await store.get(1)).toMatchObject({ probada: false, ensayo: { resultado: "no_cubierto" } });
    expect(await repair.apply(1)).toMatchObject({ ok: true });
    expect(getOverride(PORTAL, "campo_titulo")).toMatchObject({ selector: "#titulo-v2" });
  });

  it("con más de 24 h entre la prueba y la aprobación se vuelve a ensayar; si ya no pasa, no se aplica", async () => {
    let pass = true;
    const { repair, rehearse, store } = setup(["#titulo-v2"], async () => (pass ? PASS : FAIL));
    await repair.handleNewIncident(incident());
    clock += 25 * 3_600_000;
    pass = false;
    const refused = await repair.apply(1);
    expect(refused).toMatchObject({ ok: false, motivo: expect.stringContaining("más de 24 h") });
    expect(rehearse).toHaveBeenCalledTimes(2);
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
    expect(await store.get(1)).toMatchObject({ probada: false, estado: "propuesta" });

    // Dentro de 24 h no se repite el ensayo.
    const fresh = setup(["#titulo-v2"], async () => PASS);
    await fresh.repair.handleNewIncident(incident({ id: 2 }));
    clock += 23 * 3_600_000;
    expect(await fresh.repair.apply(2)).toMatchObject({ ok: true });
    expect(fresh.rehearse).toHaveBeenCalledTimes(1);
  });

  it("«incidentes» muestra si hay propuesta probada", async () => {
    const incidents = new FileIncidentStore(path.join(dir, "incidentes"), () => {});
    await incidents.record({ portal: PORTAL, step: "prueba_estructura", error: new Error("x"), captureStructure: async () => '{"fields":[]}' });
    const { repair } = setup(["#titulo-v2"], async () => PASS);
    await repair.handleNewIncident((await incidents.get(1))!);
    expect(await createIncomingHandler(new BotControl("fake"), incidents, repair)({ kind: "incidents" })).toContain("propuesta PROBADA");
  });
});

describe("ensayo en memoria y cola del robot", () => {
  const adapter = (healthCheck: () => Promise<void>, gaps: string[] = []) =>
    ({ slug: PORTAL, healthCheck, healthCheckGaps: () => gaps, captureStructure: async () => '{"fresco":true}' }) as unknown as PortalAdapter;

  it("el override temporal vale solo durante el ensayo, no se escribe, y se retira si pasa, si falla y si lanza", async () => {
    const seen: string[] = [];
    expect(await rehearseOnAdapter(adapter(async () => void seen.push(activeSelector(PORTAL, "campo_titulo"))), "campo_titulo", "#en-ensayo", "prueba_estructura")).toMatchObject({ resultado: "paso" });
    const failed = await rehearseOnAdapter(
      adapter(async () => {
        seen.push(activeSelector(PORTAL, "campo_titulo"));
        throw new Error("falta el campo de ana@correo.pe");
      }),
      "campo_titulo",
      "#en-ensayo-2",
      "prueba_estructura",
    );
    expect(failed).toMatchObject({ resultado: "fallo", estructura: '{"fresco":true}' });
    expect(failed.mensaje).not.toContain("ana@correo.pe");
    expect(seen).toEqual(["#en-ensayo", "#en-ensayo-2"]);
    expect(activeSelector(PORTAL, "campo_titulo")).toBe("#titulo");
    expect(trialsActive()).toBe(0);
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
    await expect(readFile(path.join(dir, "selectores.json"), "utf8")).rejects.toThrow();

    // Un selector peligroso ni se prueba, y tampoco queda nada aplicado.
    expect(await rehearseOnAdapter(adapter(async () => {}), "campo_titulo", "a;b", "publicar")).toMatchObject({ resultado: "fallo" });
    expect(trialsActive()).toBe(0);
  });

  it("si el paso que falló no lo cubre la prueba (healthCheckGaps), el ensayo no demuestra nada", async () => {
    const a = adapter(async () => {}, ["lista de candidatos", "enlace al CV", "botón de retirar"]);
    for (const step of ["leer_postulantes", "descargar_cv", "retirar"] as const) {
      expect(await rehearseOnAdapter(a, "campo_titulo", "#x", step), step).toMatchObject({ resultado: "no_cubierto" });
    }
    expect(await rehearseOnAdapter(a, "campo_titulo", "#x", "publicar")).toMatchObject({ resultado: "paso" });
    expect(stepCovered("descargar_cv", ["botón de retirar"])).toBe(true);
    expect(stepCovered("retirar", ["botón de retirar (no hay ofertas activas)"])).toBe(false);
  });

  it("la cola no ejecuta nada hasta que el robot la vacía en su turno (nunca en paralelo con un ciclo); un fallo no la rompe", async () => {
    const queue = new TrialQueue();
    const order: string[] = [];
    const first = queue.enqueue(async () => {
      order.push("a-inicio");
      await new Promise((r) => setTimeout(r, 10));
      order.push("a-fin");
      return PASS;
    });
    const second = queue.enqueue(async () => {
      throw new Error("explotó");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual([]);
    expect(queue.pending).toBe(2);
    expect(await queue.drain()).toBe(2);
    expect(order).toEqual(["a-inicio", "a-fin"]);
    expect(await first).toMatchObject({ resultado: "paso" });
    expect(await second).toMatchObject({ resultado: "fallo", mensaje: "explotó" });
  });
});
