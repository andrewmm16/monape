import { describe, expect, it } from "vitest";
import { evaluarGateAfinidad, UMBRAL_AFINIDAD_DEFECTO } from "@/modules/caleta/gate";
import type { Assessment, EvaluationResult, RequirementInput } from "@/modules/evaluation/types";

function requisito(
  id: string,
  isEssential: boolean,
  overrides: Partial<RequirementInput> = {},
): RequirementInput {
  return {
    id,
    category: "experiencia",
    priority: isEssential ? "obligatorio" : "deseable",
    description: `Requisito ${id}`,
    keywords: [],
    weight: 1,
    minYears: null,
    isEssential,
    ...overrides,
  };
}

function detalle(
  items: Array<{ requirementId: string; assessment: Assessment }>,
  score: number,
): EvaluationResult {
  return {
    method: "reglas",
    methodVersion: "test",
    scoringVersion: "test",
    model: null,
    items: items.map((i) => ({ ...i, evidence: [], rationale: "" })),
    scores: { score, potential: score, coverage: score, unknown: 0, notMet: 0 },
    level: "parcial",
    summary: "",
    limitations: [],
  };
}

describe("gate de afinidad de Caleta", () => {
  it("el umbral por defecto es 40", () => {
    expect(UMBRAL_AFINIDAD_DEFECTO).toBe(40);
  });

  it("pasa cuando los indispensables tienen evidencia (pendiente_verificacion cuenta) y el score llega al umbral", () => {
    const reqs = [requisito("a", true), requisito("b", false)];
    const det = detalle(
      [
        { requirementId: "a", assessment: "pendiente_verificacion" },
        { requirementId: "b", assessment: "acreditado" },
      ],
      40,
    );
    const r = evaluarGateAfinidad(reqs, det);
    expect(r.pasa).toBe(true);
    expect(r.cumpleIndispensables).toBe(true);
    expect(r.indispensablesFaltantes).toEqual([]);
  });

  it("descarta si a un indispensable le falta evidencia, aunque el score sea alto", () => {
    const reqs = [requisito("a", true, { description: "Colegiatura CIP" }), requisito("b", false)];
    const det = detalle(
      [
        { requirementId: "a", assessment: "sin_evidencia" },
        { requirementId: "b", assessment: "acreditado" },
      ],
      90,
    );
    const r = evaluarGateAfinidad(reqs, det);
    expect(r.pasa).toBe(false);
    expect(r.cumpleIndispensables).toBe(false);
    expect(r.indispensablesFaltantes).toEqual(["Colegiatura CIP"]);
    expect(r.motivo).toContain("Colegiatura CIP");
  });

  it("descarta si un indispensable está no_cumplido", () => {
    const reqs = [requisito("a", true)];
    const det = detalle([{ requirementId: "a", assessment: "no_cumplido" }], 80);
    expect(evaluarGateAfinidad(reqs, det).pasa).toBe(false);
  });

  it("descarta por umbral cuando el score es menor, aunque cumpla los indispensables", () => {
    const reqs = [requisito("a", true)];
    const det = detalle([{ requirementId: "a", assessment: "pendiente_verificacion" }], 39);
    const r = evaluarGateAfinidad(reqs, det);
    expect(r.pasa).toBe(false);
    expect(r.cumpleIndispensables).toBe(true);
    expect(r.motivo).toContain("39");
  });

  it("40 exacto pasa (límite inclusivo)", () => {
    const reqs = [requisito("a", true)];
    const det = detalle([{ requirementId: "a", assessment: "acreditado" }], 40);
    expect(evaluarGateAfinidad(reqs, det).pasa).toBe(true);
  });

  it("redondea el score antes de comparar (39.6 -> 40 pasa)", () => {
    const reqs = [requisito("a", true)];
    const det = detalle([{ requirementId: "a", assessment: "pendiente_verificacion" }], 39.6);
    const r = evaluarGateAfinidad(reqs, det);
    expect(r.score).toBe(40);
    expect(r.pasa).toBe(true);
  });

  it("sin requisitos indispensables, basta con el umbral", () => {
    const reqs = [requisito("a", false), requisito("b", false)];
    const det = detalle(
      [
        { requirementId: "a", assessment: "acreditado" },
        { requirementId: "b", assessment: "sin_evidencia" },
      ],
      50,
    );
    expect(evaluarGateAfinidad(reqs, det).pasa).toBe(true);
  });

  it("respeta un umbral personalizado", () => {
    const reqs = [requisito("a", true)];
    const det = detalle([{ requirementId: "a", assessment: "pendiente_verificacion" }], 45);
    expect(evaluarGateAfinidad(reqs, det, 50).pasa).toBe(false);
    expect(evaluarGateAfinidad(reqs, det, 40).pasa).toBe(true);
  });

  it("un indispensable sin item en el detalle se considera faltante", () => {
    const reqs = [requisito("a", true), requisito("b", false)];
    const det = detalle([{ requirementId: "b", assessment: "acreditado" }], 80);
    const r = evaluarGateAfinidad(reqs, det);
    expect(r.pasa).toBe(false);
    expect(r.indispensablesFaltantes).toEqual(["Requisito a"]);
  });
});
