import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElement } from "../../bot/src/locate";
import { captureStructure } from "../../bot/src/structure";

/** Páginas inventadas con `setContent`: no dependen del portal falso. */
let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(() => browser.close());
beforeEach(async () => {
  page = await browser.newPage();
});

describe("captureStructure", () => {
  const HTML = `
    <title>Postulante: Lucía Ramos</title><h1>Lucía Ramos Ficticia</h1>
    <label for="titulo">Título del puesto</label>
    <input id="titulo" name="titulo" type="text" required value="Secreto: contraseña 12345678">
    <select name="ciudad"><option>Lima</option></select>
    <table><tr><td>Lucía Ramos Ficticia</td><td>lucia@correo.pe</td><td>987654321</td></tr></table>
    <a href="/cv/1">Descargar CV de Lucía Ramos Ficticia</a>
    <p>Hola, soy Lucía y mi teléfono es 987 654 321</p>
    <button id="publicar" type="submit">Publicar aviso</button>
    <button id="cv">Descargar CV de Lucía Ramos Ficticia</button>`;

  it("devuelve campos y botones, sin valores ni textos de contenido", async () => {
    await page.setContent(HTML);
    const structure = await captureStructure(page);
    expect(structure).toContain("Publicar aviso");
    expect(structure).toContain("Título del puesto");
    expect(structure).toContain('"required":true');
    expect(structure).toContain("[texto largo]");
    for (const personal of ["Secreto", "contraseña", "Lucía", "Ramos", "lucia@correo.pe", "987"]) {
      expect(structure).not.toContain(personal);
    }
  });
});

describe("findElement", () => {
  it("usa la primera forma y no avisa si funciona", async () => {
    await page.setContent('<button>Publicar</button>');
    const onFallback = vi.fn();
    const found = await findElement(
      page,
      "botón publicar",
      [(p) => p.getByRole("button", { name: "Publicar" }), (p) => p.getByText("Publicar")],
      { timeoutMs: 300, onFallback },
    );
    expect(await found.textContent()).toBe("Publicar");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("si solo funciona una alternativa, la usa y avisa cuál", async () => {
    await page.setContent('<button>Publicar aviso</button>');
    const onFallback = vi.fn();
    const found = await findElement(
      page,
      "botón publicar",
      [(p) => p.getByRole("button", { name: "Publicar", exact: true }), (p) => p.getByRole("button", { name: /publicar/i })],
      { timeoutMs: 300, onFallback },
    );
    expect(await found.textContent()).toBe("Publicar aviso");
    expect(onFallback).toHaveBeenCalledWith("botón publicar", 1);
  });

  it("si ninguna funciona, lanza pagina_cambio con el nombre del elemento", async () => {
    await page.setContent("<p>nada</p>");
    await expect(findElement(page, "botón publicar", [(p) => p.getByRole("button")], { timeoutMs: 200 })).rejects.toMatchObject({
      code: "pagina_cambio",
      message: expect.stringContaining("botón publicar"),
    });
  });
});
