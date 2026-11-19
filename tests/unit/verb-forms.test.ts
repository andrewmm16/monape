import { describe, expect, it } from "vitest";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import type { RequirementInput } from "@/modules/evaluation/types";
import { verbFormsOf } from "@/modules/evaluation/verb-forms";

// reglas-v14: RRHH escribe las palabras clave como verbos en primera persona
// («Capacité», «Dirigí un equipo», «Alcancé la meta»), pero el CV dice
// «Capacitó», «dirigía», «capacitando»… Banco ciego del 19/11/2026.

describe("formas de un verbo en primera persona del pretérito", () => {
  it("verbos en -ar: pretérito, imperfecto, infinitivo, gerundio y presente", () => {
    expect(verbFormsOf("Capacité")).toEqual(
      expect.arrayContaining(["capacitó", "capacitaba", "capacitar", "capacitando", "capacitamos", "capacita"]),
    );
  });

  it("conserva el resto de la frase", () => {
    expect(verbFormsOf("Lideré equipos")).toEqual(expect.arrayContaining(["lideró equipos", "lideraba equipos"]));
  });

  it("verbos en -er/-ir", () => {
    expect(verbFormsOf("Dirigí un equipo")).toEqual(expect.arrayContaining(["dirigió un equipo", "dirigía un equipo", "dirigiendo un equipo", "dirige un equipo"]));
    expect(verbFormsOf("Cumplí")).toEqual(expect.arrayContaining(["cumplió", "cumplía", "cumplir"]));
  });

  it("cambios de grafía: -qué → -car, -gué → -gar, -cé → -zar, -uí → -uyó", () => {
    expect(verbFormsOf("Practiqué")).toContain("practicó");
    expect(verbFormsOf("Negocié")).toContain("negoció");
    expect(verbFormsOf("Llegué a la meta")).toContain("llegó a la meta");
    expect(verbFormsOf("Alcancé la meta")).toEqual(expect.arrayContaining(["alcanzó la meta", "alcanzando la meta"]));
    expect(verbFormsOf("Distribuí")).toEqual(expect.arrayContaining(["distribuyó", "distribuyendo", "distribuía"]));
  });

  it("no toca lo que no es un verbo en primera persona del pretérito", () => {
    expect(verbFormsOf("Capacitación de personal")).toEqual([]);
    expect(verbFormsOf("Excel")).toEqual([]);
    expect(verbFormsOf("Capacite")).toEqual([]); // sin tilde no se puede distinguir
    expect(verbFormsOf("Dí")).toEqual([]); // demasiado corto
    expect(verbFormsOf("")).toEqual([]);
  });
});

describe("el motor encuentra la palabra clave conjugada", () => {
  const REF = new Date("2026-11-19T12:00:00Z");
  const req = (keywords: string[]): RequirementInput => ({
    id: "r",
    category: "experiencia",
    priority: "deseable",
    description: "Experiencia capacitando equipos",
    keywords,
    weight: 2,
    minYears: null,
    isEssential: false,
  });
  const evaluar = (cv: string, keywords: string[]) => evaluateWithRules(cv, [req(keywords)], { referenceDate: REF })[0]!;

  it.each([
    "Supervisora de call center 2020 - actualidad. Capacitó a 14 asesores nuevos.",
    "Supervisora de call center 2020 - actualidad. Capacitaba a los asesores nuevos.",
    "Supervisora 2020 - actualidad, capacitando a los asesores nuevos.",
  ])("«Capacité» encuentra: %s", (cv) => {
    const item = evaluar(`Experiencia\n${cv}`, ["Capacité"]);
    expect(item.assessment).toBe("acreditado");
    expect(item.rationale).toContain("El CV menciona: Capacité.");
  });

  it("una frase con el verbo conjugado («dirigió un equipo»)", () => {
    expect(evaluar("Experiencia\nJefe de almacén 2019 - 2024. Dirigió un equipo de 12 operarios.", ["Dirigí un equipo"]).assessment).toBe(
      "acreditado",
    );
  });

  it("sin el verbo, sigue sin evidencia", () => {
    expect(evaluar("Experiencia\nAsesora de ventas 2020 - actualidad.", ["Capacité"]).assessment).toBe("sin_evidencia");
  });
});
