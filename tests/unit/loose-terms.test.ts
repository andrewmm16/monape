import { describe, expect, it } from "vitest";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import { findLooseTermOccurrences, normalizeForSearch } from "@/modules/evaluation/text";
import type { RequirementInput } from "@/modules/evaluation/types";

// reglas-v14: la palabra clave con palabras intercaladas («Negociación anual con
// transportistas y proveedores» para «Negociación con proveedores»). Banco ciego
// del 19/11/2026.

const encuentra = (texto: string, termino: string) => findLooseTermOccurrences(normalizeForSearch(texto), termino).length > 0;

describe("palabras intercaladas en la palabra clave", () => {
  it.each([
    ["Negociación anual con transportistas y proveedores: ahorro de 8 %.", "Negociación con proveedores"],
    ["Atención telefónica al cliente en campaña de retención.", "Atención al cliente"],
    ["Gestión integral de planillas de 300 trabajadores.", "Gestión de planillas"],
    ["Gestión de cobranzas y planillas.", "Gestión de planillas"],
    ["Residente de la obra Edificio Los Pinos.", "Residente de obra"],
    ["Negociación con transportistas, agencias y proveedores.", "Negociación con proveedores"],
  ])("«%s» contiene «%s»", (texto, termino) => {
    expect(encuentra(texto, termino)).toBe(true);
  });

  it.each([
    ["Supervisor de seguridad en obra, 2019 - 2024.", "Supervisor de obra"], // otro cargo
    ["Experiencia nula en ventas.", "Experiencia en ventas"], // negación en medio
    ["Negociación de tarifas anuales con proveedores.", "Negociación con proveedores"], // 3 palabras en medio
    ["Negociación. Proveedores locales.", "Negociación con proveedores"], // otra frase
    ["Proveedores con negociación anual.", "Negociación con proveedores"], // otro orden
    ["Manejo básico de planillas.", "Manejo de planillas"], // un nivel en medio
    ["Excel y Word avanzado.", "Excel avanzado"], // la palabra clave lleva un nivel
  ])("«%s» NO contiene «%s»", (texto, termino) => {
    expect(encuentra(texto, termino)).toBe(false);
  });

  it("una palabra clave de una sola palabra no usa esta búsqueda", () => {
    expect(encuentra("Excel avanzado", "Excel")).toBe(false);
  });
});

describe("el motor acredita con palabras intercaladas", () => {
  const req: RequirementInput = {
    id: "r",
    category: "habilidad_tecnica",
    priority: "deseable",
    description: "Negociación con transportistas y proveedores",
    keywords: ["Negociación con proveedores"],
    weight: 2,
    minYears: null,
    isEssential: false,
  };

  it("acredita y cita la frase completa", () => {
    const cv = "Experiencia\nCoordinador de logística 2020 - actualidad\nNegociación anual con transportistas y proveedores: ahorro de 8 % en fletes.";
    const item = evaluateWithRules(cv, [req], { referenceDate: new Date("2026-11-19T12:00:00Z") })[0]!;
    expect(item.assessment).toBe("acreditado");
    expect(item.evidence[0]!.quote).toContain("Negociación anual con transportistas y proveedores");
  });
});
