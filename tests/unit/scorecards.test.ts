import { describe, expect, it } from "vitest";
import { consolidateScorecards, type ScorecardEntry } from "@/modules/scorecards/consolidation";

function entry(
  id: string,
  recommendation: ScorecardEntry["recommendation"],
  scores: Record<string, number>,
): ScorecardEntry {
  return {
    id,
    evaluatorId: id,
    evaluatorName: id.toUpperCase(),
    recommendation,
    comment: null,
    scores: Object.entries(scores).map(([competency, score]) => ({ competency, score, comment: "" })),
    updatedAt: "2026-11-16T00:00:00Z",
  };
}

describe("consolidateScorecards", () => {
  it("sin evaluaciones devuelve promedios nulos y sin desacuerdos", () => {
    const result = consolidateScorecards([]);
    expect(result.evaluators).toBe(0);
    expect(result.overall).toBeNull();
    expect(result.perCompetency.every((item) => item.average === null && !item.disagreement)).toBe(true);
    expect(result.recommendations).toEqual({ avanza: 0, duda: 0, no_avanza: 0 });
  });

  it("promedia por competencia, marca el desacuerdo y cuenta las recomendaciones", () => {
    const a = entry("a", "avanza", { tecnica: 5, comunicacion: 4, resolucion: 4, experiencia: 5, fit: 5 });
    const b = entry("b", "no_avanza", { tecnica: 2, comunicacion: 4, resolucion: 3, experiencia: 3, fit: 4 });
    const result = consolidateScorecards([a, b]);

    expect(result.evaluators).toBe(2);

    const tecnica = result.perCompetency.find((item) => item.competency === "tecnica")!;
    expect(tecnica.average).toBe(3.5);
    expect(tecnica.min).toBe(2);
    expect(tecnica.max).toBe(5);
    expect(tecnica.disagreement).toBe(true); // brecha 3 ≥ umbral 2

    const comunicacion = result.perCompetency.find((item) => item.competency === "comunicacion")!;
    expect(comunicacion.average).toBe(4);
    expect(comunicacion.disagreement).toBe(false);

    expect(result.recommendations).toEqual({ avanza: 1, duda: 0, no_avanza: 1 });

    const allScores = [5, 4, 4, 5, 5, 2, 4, 3, 3, 4];
    expect(result.overall).toBeCloseTo(allScores.reduce((x, y) => x + y, 0) / allScores.length);
  });
});
