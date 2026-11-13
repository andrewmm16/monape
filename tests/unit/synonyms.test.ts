import { describe, it, expect } from "vitest";
import { equivalentsFor } from "@/modules/evaluation/synonyms";

describe("equivalentsFor", () => {
  it("devuelve equivalentes de un término del diccionario, sin incluirlo", () => {
    const eq = equivalentsFor("contabilidad").map((s) => s.toLowerCase());
    expect(eq).toContain("libros contables");
    expect(eq).not.toContain("contabilidad");
  });
  it("es simétrico dentro del grupo", () => {
    expect(equivalentsFor("contable").map((s) => s.toLowerCase())).toContain("contabilidad");
  });
  it("ignora mayúsculas y tildes al emparejar", () => {
    expect(equivalentsFor("CONTABILIDAD").length).toBeGreaterThan(0);
  });
  it("devuelve [] para un término fuera del diccionario", () => {
    expect(equivalentsFor("xyzzy")).toEqual([]);
  });
});
