import { describe, it, expect } from "vitest";
import { assembleVisibleText, type PdfItem, type PdfPage } from "@/modules/resumes/pdf-text";

const box = { width: 612, height: 792 }; // carta, en puntos PDF

function item(partial: Partial<PdfItem>): PdfItem {
  return { str: "texto", fontSize: 11, x: 100, y: 400, hasEOL: false, ...partial };
}

function page(items: PdfItem[]): PdfPage {
  return { items, box };
}

describe("assembleVisibleText", () => {
  it("replica el ensamblado de unpdf: str + EOL, y colapsa espacios sin romper líneas", () => {
    const pages = [
      page([
        item({ str: "Hola ", hasEOL: false }),
        item({ str: "mundo", hasEOL: true }),
        item({ str: "Segunda   línea", hasEOL: false }),
      ]),
    ];
    const { text, hidden } = assembleVisibleText(pages);
    expect(text).toBe("Hola mundo\nSegunda línea");
    expect(hidden).toEqual([]);
  });

  it("une varias páginas con un salto de línea", () => {
    const pages = [
      page([item({ str: "Página uno", hasEOL: false })]),
      page([item({ str: "Página dos", hasEOL: false })]),
    ];
    expect(assembleVisibleText(pages).text).toBe("Página uno\nPágina dos");
  });

  it("excluye del texto un fragmento con fuente minúscula y lo reporta como oculto", () => {
    const pages = [
      page([
        item({ str: "Asistente contable", hasEOL: true }),
        item({ str: "SQL Python Java AWS", fontSize: 0.5, hasEOL: false }),
      ]),
    ];
    const { text, hidden } = assembleVisibleText(pages);
    expect(text).toBe("Asistente contable\n"); // fiel a unpdf: el trim lo hace normalizeExtractedText
    expect(text).not.toContain("SQL");
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.reason).toBe("tiny");
    expect(hidden[0]!.fragment.str).toBe("SQL Python Java AWS");
  });

  it("excluye un fragmento empujado fuera de la página (keyword stuffing)", () => {
    const pages = [
      page([
        item({ str: "Analista de datos", hasEOL: true }),
        item({ str: "React Angular Vue", x: 5000, hasEOL: false }),
      ]),
    ];
    const { text, hidden } = assembleVisibleText(pages);
    expect(text).toBe("Analista de datos\n");
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.reason).toBe("offpage");
  });

  it("no inventa ni altera un CV normal (sin ocultos)", () => {
    const pages = [
      page([
        item({ str: "Contabilidad general", hasEOL: true }),
        item({ str: "Manejo de PLAME y T-Registro", hasEOL: true, y: 380 }),
      ]),
    ];
    const { text, hidden } = assembleVisibleText(pages);
    expect(text).toBe("Contabilidad general\nManejo de PLAME y T-Registro\n");
    expect(hidden).toEqual([]);
  });

  it("respeta un umbral de fuente configurable", () => {
    const pages = [page([item({ str: "visible pequeño", fontSize: 2.5 })])];
    expect(assembleVisibleText(pages, { minFontSize: 2 }).hidden).toEqual([]);
    expect(assembleVisibleText(pages, { minFontSize: 3 }).hidden).toHaveLength(1);
  });
});
