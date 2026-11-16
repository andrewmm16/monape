import { describe, expect, it } from "vitest";
import { assembleEvaluation } from "@/modules/evaluation/assemble";
import { computeScores, determineLevel } from "@/modules/evaluation/scoring";
import type { Assessment, RequirementInput } from "@/modules/evaluation/types";

function requirement(id: string, weight: number, overrides: Partial<RequirementInput> = {}): RequirementInput {
  return {
    id,
    category: "habilidad_tecnica",
    priority: "obligatorio",
    description: `Requisito ${id}`,
    keywords: [],
    weight,
    minYears: null,
    isEssential: false,
    ...overrides,
  };
}

const item = (weight: number, assessment: Assessment, priority: "obligatorio" | "deseable" = "obligatorio") => ({
  weight,
  assessment,
  priority,
});

describe("computeScores", () => {
  it("calcula porcentajes ponderados con la metodología documentada", () => {
    const scores = computeScores([item(5, "acreditado"), item(3, "sin_evidencia"), item(2, "no_cumplido")]);
    expect(scores).toEqual({ score: 50, potential: 80, coverage: 70, unknown: 30, notMet: 20 });
  });

  it("redondea a dos decimales como la base de datos", () => {
    const scores = computeScores([item(1, "acreditado"), item(2, "sin_evidencia")]);
    expect(scores.score).toBe(33.33);
    expect(scores.potential).toBe(100);
  });

  it("rechaza listas vacías", () => {
    expect(() => computeScores([])).toThrow();
  });
});

describe("determineLevel", () => {
  it("no confunde falta de información con incompatibilidad", () => {
    const items = [item(5, "sin_evidencia"), item(5, "pendiente_verificacion")];
    expect(determineLevel(computeScores(items), items)).toBe("pendiente");
  });

  it("asigna compatibilidad alta con ≥70 % acreditado y sin obligatorios no cumplidos", () => {
    const items = [item(7, "acreditado"), item(3, "sin_evidencia")];
    expect(determineLevel(computeScores(items), items)).toBe("alta");
  });

  it("un obligatorio aparentemente no cumplido impide la compatibilidad alta", () => {
    const items = [item(8, "acreditado"), item(2, "no_cumplido")];
    expect(determineLevel(computeScores(items), items)).toBe("parcial");
  });

  it("solo asigna compatibilidad baja cuando hay requisitos aparentemente no cumplidos", () => {
    const items = [item(3, "acreditado"), item(4, "no_cumplido"), item(3, "sin_evidencia")];
    expect(determineLevel(computeScores(items), items)).toBe("baja");
  });

  it("el motor de reglas no puede producir «baja» en ninguna combinación", () => {
    // Propiedad documentada en docs/metodologia-evaluacion.md §4: el motor de
    // reglas nunca asigna «no cumplido», así que puntuación + sin evidencia
    // suman 100 y una puntuación por debajo de 40 implica más del 50 % sin
    // evidencia, o sea «pendiente». «Baja» solo llega tras una verificación
    // humana. Esto lo comprueba de forma exhaustiva en vez de afirmarlo: si
    // alguien cambia los umbrales y «baja» pasa a ser alcanzable sin que
    // intervenga una persona, esta prueba lo dice.
    const DEL_MOTOR: Assessment[] = ["acreditado", "sin_evidencia", "pendiente_verificacion"];
    const PESOS = [1, 2, 5, 9];
    const niveles = new Set<string>();

    const recorrer = (items: ReturnType<typeof item>[], falta: number): void => {
      if (items.length > 0) niveles.add(determineLevel(computeScores(items), items));
      if (falta === 0) return;
      for (const peso of PESOS) {
        for (const assessment of DEL_MOTOR) {
          for (const priority of ["obligatorio", "deseable"] as const) {
            items.push(item(peso, assessment, priority));
            recorrer(items, falta - 1);
            items.pop();
          }
        }
      }
    };
    recorrer([], 3);

    expect(niveles.has("baja")).toBe(false);
    expect([...niveles].sort()).toEqual(["alta", "parcial", "pendiente"]);
  });
});

describe("assembleEvaluation", () => {
  const requirements = [requirement("a", 5), requirement("b", 3, { isEssential: true }), requirement("c", 2)];

  it("es reproducible: mismas entradas producen el mismo resultado", () => {
    const input = {
      method: "reglas" as const,
      methodVersion: "reglas-v1",
      model: null,
      requirements,
      items: [
        { requirementId: "a", assessment: "acreditado" as const, evidence: [{ quote: "SQL" }], rationale: "x" },
        { requirementId: "b", assessment: "pendiente_verificacion" as const, evidence: [], rationale: "y" },
        { requirementId: "c", assessment: "sin_evidencia" as const, evidence: [], rationale: "z" },
      ],
      textWasCorrected: false,
      textTruncated: false,
    };
    const first = assembleEvaluation(input);
    expect(assembleEvaluation(input)).toEqual(first);
    expect(first.scores.score).toBe(50);
    expect(first.level).toBe("parcial");
    expect(first.summary).toContain("1 acreditado");
    expect(first.limitations.join(" ")).toContain("no es una probabilidad de contratación");
    expect(first.limitations.join(" ")).toContain("legales o esenciales");
  });

  it("exige una valoración por cada requisito vigente", () => {
    expect(() =>
      assembleEvaluation({
        method: "reglas",
        methodVersion: "reglas-v1",
        model: null,
        requirements,
        items: [],
        textWasCorrected: false,
        textTruncated: false,
      }),
    ).toThrow(/Falta la valoración/);
  });
});
