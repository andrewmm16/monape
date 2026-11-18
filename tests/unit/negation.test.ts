import { describe, expect, it } from "vitest";
import { findExplicitNegations, markExplicitNegation, negationFor } from "@/modules/evaluation/negation";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import type { ItemAssessment, RequirementInput } from "@/modules/evaluation/types";

const req = (description: string, keywords: string[], extra: Partial<RequirementInput> = {}): RequirementInput => ({
  id: "r1",
  category: "habilidad_tecnica",
  priority: "obligatorio",
  description,
  keywords,
  weight: 5,
  minYears: null,
  isEssential: false,
  ...extra,
});

describe("negaciones explícitas del CV (reglas-v12)", () => {
  it("encuentra cada negación de la línea, también las encadenadas con «ni en»", () => {
    const n = findExplicitNegations("Perfil\nNo cuento con experiencia en planillas, ni en PLAME.\nManejo Excel.");
    expect(n.map((x) => x.words)).toEqual([["planillas"], ["plame"]]);
    expect(n[0]!.quote).toBe("No cuento con experiencia en planillas, ni en PLAME.");
  });

  it("empareja con el requisito aunque no use sus palabras clave exactas", () => {
    const reclamos = findExplicitNegations("Sin experiencia en reclamos.");
    expect(negationFor(req("Experiencia en gestión de reclamos", ["gestión de reclamos"]), reclamos)).not.toBeNull();
    // «programación» y «programador» comparten raíz.
    const programacion = findExplicitNegations("Busco mi primer empleo; sin experiencia en programación.");
    expect(negationFor(req("Mínimo 3 años como desarrollador", ["programador", "desarrollador web"]), programacion)).not.toBeNull();
    // Siglas cortas en las palabras clave.
    expect(negationFor(req("Manejo de CRM", ["CRM", "Zendesk"]), findExplicitNegations("Sin experiencia en sistemas CRM."))).not.toBeNull();
  });

  it("une las frases que el PDF partió en varias líneas (la continuación empieza en minúscula)", () => {
    const n = findExplicitNegations("Responsable y puntual; sin\nexperiencia en reclamos ni en sistemas CRM.\nEXPERIENCIA LABORAL");
    expect(negationFor(req("Experiencia en gestión de reclamos", ["gestión de reclamos"]), n)).not.toBeNull();
    const m = findExplicitNegations("Atención al personal. No cuento\ncon experiencia en planillas ni en PLAME, pero sí en legajos.");
    expect(negationFor(req("Mínimo 2 años en planillas", ["planillas"], { category: "experiencia" }), m)).not.toBeNull();
    // Familia del puesto (lista revisada de cargos): «programación» niega «desarrollador».
    const p = findExplicitNegations("Diseñadora gráfica. Sin experiencia en\nprogramación.");
    expect(negationFor(req("Mínimo 3 años de experiencia como desarrollador web", ["desarrollador", "full stack"], { category: "experiencia" }), p)).not.toBeNull();
  });

  it("no inventa negaciones: otro tema, otra línea, «pero…» o frases que no niegan", () => {
    const crm = req("Manejo de CRM", ["CRM", "Zendesk"]);
    expect(negationFor(crm, findExplicitNegations("Sin experiencia en ventas\nCRM: Zendesk"))).toBeNull();
    expect(negationFor(crm, findExplicitNegations("Sin experiencia en ventas pero sí en CRM."))).toBeNull();
    expect(findExplicitNegations("No es un problema: manejo SAP y CRM.")).toEqual([]);
    expect(negationFor(req("Experiencia en gestión de personal", ["gestión de personal"]), findExplicitNegations("Sin experiencia en gestión de reclamos."))).toBeNull();
  });

  it("marca la duda sin cambiar la valoración; no toca lo acreditado ni lo verificado", () => {
    const negs = findExplicitNegations("Sin experiencia en reclamos.");
    const r = req("Experiencia en gestión de reclamos", ["gestión de reclamos"]);
    const item = (assessment: ItemAssessment["assessment"], extra: Partial<ItemAssessment> = {}): ItemAssessment => ({
      requirementId: "r1",
      assessment,
      evidence: [],
      rationale: "Motivo.",
      ...extra,
    });
    const marcado = markExplicitNegation(item("sin_evidencia"), r, negs);
    expect(marcado).toMatchObject({ assessment: "sin_evidencia", signal: "negacion_explicita" });
    expect(marcado.rationale).toContain("«Sin experiencia en reclamos.»");
    expect(markExplicitNegation(item("acreditado"), r, negs)).toEqual(item("acreditado"));
    expect(markExplicitNegation(item("sin_evidencia", { cvAssessment: "sin_evidencia" }), r, negs).signal).toBeUndefined();
  });

  it("el motor la marca en el CV real; la valoración no cambia", () => {
    const cv = "ATENCIÓN AL CLIENTE\nRecepcionista 2023 - Actualidad\nSin experiencia en reclamos ni en sistemas CRM.";
    const [reclamos, crm] = evaluateWithRules(
      cv,
      [req("Experiencia en gestión de reclamos", ["gestión de reclamos"]), { ...req("Manejo de CRM", ["CRM", "Zendesk"]), id: "r2" }],
      { referenceDate: new Date("2026-11-18T12:00:00Z") },
    );
    expect(reclamos).toMatchObject({ assessment: "sin_evidencia", signal: "negacion_explicita" });
    expect(crm).toMatchObject({ signal: "negacion_explicita" });
  });
});
