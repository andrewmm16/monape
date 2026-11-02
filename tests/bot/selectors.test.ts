import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activeSelector,
  configureSelectorState,
  describeBook,
  estricto,
  getOverride,
  probeElement,
  readTolerances,
  recordTolerance,
  registerBook,
  removeOverride,
  resetSelectorState,
  resolveAll,
  resolveCss,
  resolveElement,
  setOverride,
  tolerante,
  validateSelector,
} from "../../bot/src/selectors";

/** Páginas inventadas con `setContent`: el libro de prueba no pertenece a ningún portal real. */
const PORTAL = "libro-prueba";
registerBook(PORTAL, {
  campo_titulo: tolerante("Campo del título", "#titulo", [{ etiqueta: ["Título", "Cargo"] }, { css: "[name^=titulo]" }]),
  boton_enviar: estricto("Botón de publicar", "#publicar"),
  boton_siguiente: tolerante("Botón siguiente", "#siguiente", [{ rol: "button", nombre: ["Siguiente", "Continuar"] }]),
  aviso_cookies: tolerante("Aceptar cookies", null, [{ texto: ["Aceptar"], css: "[class*='cookie' i] button" }]),
  paso: estricto("Marca del paso {n}", "#paso-{n}"),
  filas: tolerante("Filas", "tr.fila", [{ css: "tr[data-id]" }]),
  correo: tolerante("Correo", ".mail", [{ css: "[class*='correo']" }]),
});

let browser: Browser;
let page: Page;
let dir: string;
const logs: string[] = [];
const files = () => ({ overridesFile: path.join(dir, "selectores.json"), tolerancesFile: path.join(dir, "tolerancias.json") });

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(() => browser.close());
beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "selectores-"));
  logs.length = 0;
  configureSelectorState({ ...files(), log: (m) => void logs.push(m) });
  page = await browser.newPage();
});
afterEach(async () => {
  await page.close();
  resetSelectorState();
  rmSync(dir, { recursive: true, force: true });
});

const opts = { timeoutMs: 300 };

describe("orden de resolución: override → defecto → alternativas", () => {
  it("con el selector por defecto no hay fallback ni constancia", async () => {
    await page.setContent('<label for="titulo">Título</label><input id="titulo" name="titulo">');
    const found = await resolveElement(page, PORTAL, "campo_titulo", opts);
    expect(await found.getAttribute("id")).toBe("titulo");
    expect(readTolerances()).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("si el defecto ya no está, usa la alternativa por etiqueta, la anota y deja un log legible", async () => {
    await page.setContent('<label for="titulo-v2">Cargo del puesto</label><input id="titulo-v2" name="titulo_v2">');
    const found = await resolveElement(page, PORTAL, "campo_titulo", opts);
    expect(await found.getAttribute("id")).toBe("titulo-v2");
    const events = readTolerances();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ portal: PORTAL, clave: "campo_titulo", indiceUsado: 1 });
    expect(Date.parse(events[0]!.timestamp)).not.toBeNaN();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("campo_titulo");
    expect(logs[0]).toContain("alternativa 1");
    // El archivo es exactamente {timestamp, portal, clave, indiceUsado}.
    expect(Object.keys(JSON.parse(readFileSync(files().tolerancesFile, "utf8")).eventos[0]).sort()).toEqual(["clave", "indiceUsado", "portal", "timestamp"]);
  });

  it("la segunda alternativa lleva el índice 2", async () => {
    await page.setContent('<input name="titulo_v2">');
    await resolveElement(page, PORTAL, "campo_titulo", opts);
    expect(readTolerances()[0]).toMatchObject({ indiceUsado: 2 });
  });

  it("un override aprobado va primero, también antes del selector por defecto, y no cuenta como tolerancia", async () => {
    await page.setContent('<input id="titulo"><input id="nuevo-titulo">');
    setOverride(PORTAL, "campo_titulo", { selector: "#nuevo-titulo", aprobadoEn: "2026-01-01T00:00:00Z", incidenteId: 3 });
    expect(await (await resolveElement(page, PORTAL, "campo_titulo", opts)).getAttribute("id")).toBe("nuevo-titulo");
    expect(readTolerances()).toEqual([]);
    // Si el override deja de servir, vuelve al defecto.
    await page.setContent('<input id="titulo">');
    expect(await (await resolveElement(page, PORTAL, "campo_titulo", opts)).getAttribute("id")).toBe("titulo");
  });

  it("un elemento ESTRICTO no usa alternativas: sin el selector exacto lanza pagina_cambio", async () => {
    await page.setContent("<button>Publicar</button>");
    await expect(resolveElement(page, PORTAL, "boton_enviar", opts)).rejects.toMatchObject({ code: "pagina_cambio", message: expect.stringContaining("[boton_enviar]") });
    expect(readTolerances()).toEqual([]);
    // Con un override aprobado por una persona sí se encuentra.
    setOverride(PORTAL, "boton_enviar", { selector: "button", aprobadoEn: "2026-01-01T00:00:00Z", incidenteId: 1 });
    expect(await (await resolveElement(page, PORTAL, "boton_enviar", opts)).textContent()).toBe("Publicar");
  });

  it("si nada funciona, lanza pagina_cambio con la descripción, la clave y la pantalla", async () => {
    await page.setContent("<p>nada</p>");
    await expect(resolveElement(page, PORTAL, "campo_titulo", { ...opts, where: "el paso 1" })).rejects.toMatchObject({
      code: "pagina_cambio",
      message: expect.stringMatching(/«Campo del título» \[campo_titulo\] en el paso 1 \(se probaron 3 formas/),
    });
  });

  it("una clave que no está en el libro es un error de programación, no un cambio del portal", async () => {
    await expect(resolveElement(page, PORTAL, "no_existe", opts)).rejects.toThrow(/desconocida/);
  });

  it("los marcadores {n} se sustituyen en el selector", async () => {
    expect(activeSelector(PORTAL, "paso", { n: 3 })).toBe("#paso-3");
    // Los overrides son CSS literal (sin llaves): no se pueden cambiar las claves con marcadores.
    expect(() => setOverride(PORTAL, "paso", { selector: "[data-step='{n}']", aprobadoEn: "x", incidenteId: 1 })).toThrow();
  });
});

describe("botones, listas y opcionales", () => {
  it("navegación tolerante: «Continuar» sirve por rol si el botón cambió de id", async () => {
    await page.setContent('<button id="otro">Continuar</button>');
    expect(await (await resolveElement(page, PORTAL, "boton_siguiente", opts)).getAttribute("id")).toBe("otro");
    expect(readTolerances()[0]).toMatchObject({ clave: "boton_siguiente", indiceUsado: 1 });
  });

  it("probeElement no espera: null si no hay nada; con aviso de cookies devuelve el botón y lo anota", async () => {
    await page.setContent("<p>sin aviso</p>");
    const started = Date.now();
    expect(await probeElement(page, PORTAL, "aviso_cookies")).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
    await page.setContent('<div class="Cookies-Banner"><button>Aceptar todas</button><button>Rechazar</button></div>');
    const accept = await probeElement(page, PORTAL, "aviso_cookies");
    expect(await accept!.textContent()).toBe("Aceptar todas");
    expect(readTolerances()[0]).toMatchObject({ clave: "aviso_cookies", indiceUsado: 1 }); // sin selector por defecto: siempre es una alternativa
  });

  it("resolveAll devuelve todos los elementos de la forma que funcionó; resolveCss, el CSS que sirve dentro de una fila", async () => {
    await page.setContent('<table><tr data-id="1"><td class="correo-x">a</td></tr><tr data-id="2"><td class="correo-x">b</td></tr></table>');
    const rows = await resolveAll(page, PORTAL, "filas", { ...opts, state: "attached" });
    expect(await rows.count()).toBe(2);
    expect(await resolveCss(rows.first(), PORTAL, "correo")).toBe("[class*='correo']");
    await page.setContent('<table><tr class="fila"><td class="mail">a</td></tr></table>');
    expect(await resolveCss(page.locator("tr.fila").first(), PORTAL, "correo")).toBe(".mail");
  });
});

describe("archivos de estado", () => {
  it("un selectores.json dañado o con entradas inválidas se ignora sin lanzar", () => {
    writeFileSync(files().overridesFile, "{ esto no es json");
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
    writeFileSync(
      files().overridesFile,
      JSON.stringify({ version: 1, overrides: { [PORTAL]: { campo_titulo: { selector: "a;b", aprobadoEn: "x", incidenteId: 1 }, boton_enviar: { selector: "#ok", aprobadoEn: "x", incidenteId: 2 } } } }),
    );
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined(); // selector peligroso: no se aplica
    expect(getOverride(PORTAL, "boton_enviar")).toMatchObject({ selector: "#ok", incidenteId: 2 });
  });

  it("escribe y quita overrides de forma atómica (sin archivos temporales) y quitar solo borra lo del incidente indicado", () => {
    setOverride(PORTAL, "campo_titulo", { selector: "#a", aprobadoEn: "2026-01-01T00:00:00Z", incidenteId: 4 });
    setOverride(PORTAL, "boton_enviar", { selector: "#b", aprobadoEn: "2026-01-01T00:00:00Z", incidenteId: 5 });
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(removeOverride(PORTAL, "campo_titulo", 99)).toBe(false);
    expect(getOverride(PORTAL, "campo_titulo")).toBeDefined();
    expect(removeOverride(PORTAL, "campo_titulo", 4)).toBe(true);
    expect(getOverride(PORTAL, "campo_titulo")).toBeUndefined();
    expect(getOverride(PORTAL, "boton_enviar")).toMatchObject({ selector: "#b" });
    expect(() => setOverride(PORTAL, "campo_titulo", { selector: "<b>", aprobadoEn: "x", incidenteId: 1 })).toThrow();
  });

  it("las tolerancias guardan solo las últimas 500 y registrar nunca lanza (aunque no se pueda escribir)", () => {
    for (let i = 0; i < 510; i++) recordTolerance(PORTAL, "campo_titulo", 1);
    expect(readTolerances()).toHaveLength(500);
    writeFileSync(path.join(dir, "bloqueo"), "x");
    configureSelectorState({ tolerancesFile: path.join(dir, "bloqueo", "tolerancias.json") });
    expect(() => recordTolerance(PORTAL, "campo_titulo", 1)).not.toThrow();
    expect(logs.some((l) => l.includes("No se pudo anotar la tolerancia"))).toBe(true);
    writeFileSync(files().tolerancesFile, "[[roto");
    expect(readTolerances(files().tolerancesFile)).toEqual([]); // dañado: se lee como vacío
  });

  it("describeBook lista clave, descripción, estricta y el selector vigente (con override) para el prompt", () => {
    setOverride(PORTAL, "campo_titulo", { selector: "#nuevo", aprobadoEn: "x", incidenteId: 1 });
    const book = describeBook(PORTAL);
    expect(book.find((e) => e.clave === "campo_titulo")).toMatchObject({ descripcion: "Campo del título", estricto: false, selector: "#nuevo" });
    expect(book.find((e) => e.clave === "campo_titulo")!.alternativas[0]).toContain("etiqueta");
    expect(book.find((e) => e.clave === "boton_enviar")).toMatchObject({ estricto: true, selector: "#publicar", alternativas: [] });
  });

  it("validateSelector: los criterios de la reparación asistida", () => {
    expect(validateSelector("#a > .b[name='x']")).toBeNull();
    for (const bad of ["", "   ", "a;b", "a{b}", "<a>", "a\nb", "x:javascript:y", "a".repeat(201), 5]) expect(validateSelector(bad), String(bad)).not.toBeNull();
  });
});
