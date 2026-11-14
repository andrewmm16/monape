import { describe, it, expect } from "vitest";
import { findHiddenFragments, summarizeHidden, type HiddenFragment, type TextFragment, type PageBox } from "@/modules/resumes/hidden-text";

const page: PageBox = { width: 612, height: 792 }; // tamaño carta en puntos PDF

function frag(partial: Partial<TextFragment>): TextFragment {
  return { str: "texto", fontSize: 11, x: 100, y: 400, ...partial };
}

describe("findHiddenFragments", () => {
  it("no marca nada en un CV normal", () => {
    const frags = [frag({ str: "Contabilidad" }), frag({ str: "Experiencia", y: 350 })];
    expect(findHiddenFragments(frags, page)).toEqual([]);
  });

  it("marca texto con fuente minúscula (truco de tamaño ~0)", () => {
    const frags = [frag({ str: "SQL Python Java", fontSize: 0.5 })];
    const hidden = findHiddenFragments(frags, page);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.reason).toBe("tiny");
    expect(hidden[0]!.fragment.str).toBe("SQL Python Java");
  });

  it("marca texto fuera del área visible de la página", () => {
    const frags = [frag({ str: "keywords ocultos", x: 5000 })];
    const hidden = findHiddenFragments(frags, page);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.reason).toBe("offpage");
  });

  it("marca texto con coordenada negativa (fuera por arriba/izquierda)", () => {
    const frags = [frag({ str: "stuffing", y: -200 })];
    expect(findHiddenFragments(frags, page)[0]!.reason).toBe("offpage");
  });

  it("no marca texto en el borde legítimo de la página", () => {
    const frags = [frag({ str: "pie de página", y: 20, x: 20 })];
    expect(findHiddenFragments(frags, page)).toEqual([]);
  });

  it("respeta un umbral de fuente configurable", () => {
    const frags = [frag({ fontSize: 2.5 })];
    expect(findHiddenFragments(frags, page, { minFontSize: 2 })).toEqual([]);
    expect(findHiddenFragments(frags, page, { minFontSize: 3 })).toHaveLength(1);
  });
});

describe("summarizeHidden", () => {
  function hidden(str: string): HiddenFragment {
    return { fragment: { str, fontSize: 0.5, x: 0, y: 0 }, reason: "tiny" };
  }

  it("devuelve null cuando no hay nada oculto", () => {
    expect(summarizeHidden([])).toBeNull();
  });

  it("devuelve null si los fragmentos ocultos están en blanco", () => {
    expect(summarizeHidden([hidden("   ")])).toBeNull();
  });

  it("incluye el contenido oculto y menciona que se excluyó de la evaluación", () => {
    const aviso = summarizeHidden([hidden("SQL Python"), hidden("AWS Scrum")]);
    expect(aviso).toContain("SQL Python");
    expect(aviso).toContain("AWS Scrum");
    expect(aviso).toContain("excluyó de la evaluación");
    expect(aviso).toContain("texto no visible");
  });

  it("recorta el contenido muy largo", () => {
    const aviso = summarizeHidden([hidden("palabra ".repeat(100))], 50);
    expect(aviso).toContain("…");
  });
});
