import { describe, expect, it } from "vitest";
import type { Assessment, ItemAssessment, RequirementInput } from "@/modules/evaluation/types";
import { rankTalent, resumeTextOf } from "@/modules/talent-pool/ranking";

const requirements: RequirementInput[] = [
  { id: "planillas", category: "experiencia", priority: "obligatorio", description: "Gestión de planillas", keywords: [], weight: 5, minYears: null, isEssential: false },
  { id: "excel", category: "herramienta", priority: "obligatorio", description: "Excel avanzado", keywords: [], weight: 3, minYears: null, isEssential: false },
  { id: "ingles", category: "idioma", priority: "deseable", description: "Inglés intermedio", keywords: [], weight: 2, minYears: null, isEssential: false },
];

const entry = (candidateId: string, name: string, assessments: [Assessment, Assessment, Assessment]) => ({
  candidateId,
  name,
  requirements,
  items: requirements.map((r, i): ItemAssessment => ({ requirementId: r.id, assessment: assessments[i]!, evidence: [], rationale: "" })),
});

describe("talento sugerido: orden con el motor", () => {
  it("ordena por obligatorios cumplidos, luego por cumplimiento y luego por nombre", () => {
    const ranked = rankTalent([
      entry("c-deseable", "Ana", ["acreditado", "sin_evidencia", "acreditado"]), // 1 de 2 oblig., 70 %
      entry("c-todo", "Zoe", ["acreditado", "acreditado", "sin_evidencia"]), // 2 de 2, 80 %
      entry("c-todo-b", "Bruno", ["acreditado", "acreditado", "sin_evidencia"]), // 2 de 2, 80 %
      entry("c-excel", "Carla", ["sin_evidencia", "acreditado", "acreditado"]), // 1 de 2, 50 %
    ]);
    expect(ranked.map((r) => r.candidateId)).toEqual(["c-todo-b", "c-todo", "c-deseable", "c-excel"]);
    expect(ranked[0]).toMatchObject({ score: 80, mandatoryMet: 2, mandatoryTotal: 2, missingMandatory: [] });
  });

  it("deja fuera a quien no llega a 40 % ni cumple todos los obligatorios", () => {
    const ranked = rankTalent([entry("bajo", "Luis", ["sin_evidencia", "sin_evidencia", "acreditado"])]); // 20 %
    expect(ranked).toEqual([]);
  });

  it("arma «falta…» con los obligatorios no acreditados, en el orden de la vacante", () => {
    const [only] = rankTalent([entry("c", "Ana", ["acreditado", "sin_evidencia", "acreditado"])]); // 70 %
    expect(only!.missingMandatory).toEqual(["Excel avanzado"]);
    expect(only!.accredited).toEqual(["Gestión de planillas", "Inglés intermedio"]);
  });

  it("limita a 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => entry(`c${i}`, `Persona ${String(i).padStart(2, "0")}`, ["acreditado", "acreditado", "acreditado"]));
    expect(rankTalent(many)).toHaveLength(20);
    expect(rankTalent(many, 5)).toHaveLength(5);
  });
});

describe("texto del CV para el motor", () => {
  it("omite los CV sin texto legible y usa el corregido por RRHH si existe", () => {
    expect(resumeTextOf({ raw_text: "texto original ".repeat(10), corrected_text: "texto corregido por RRHH ".repeat(5) })).toMatch(/^texto corregido/);
    expect(resumeTextOf({ raw_text: "texto original ".repeat(10), corrected_text: null })).toMatch(/^texto original/);
    expect(resumeTextOf({ raw_text: "muy corto", corrected_text: null })).toBeNull();
    expect(resumeTextOf(null)).toBeNull();
  });
});
