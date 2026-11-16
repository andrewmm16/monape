import type { Enums } from "@/types/database";
import { DISAGREEMENT_THRESHOLD, SCORECARD_COMPETENCIES, type CompetencyKey } from "./defaults";

export type ScorecardScore = { competency: string; score: number; comment: string };

export type ScorecardEntry = {
  id: string;
  evaluatorId: string;
  evaluatorName: string | null;
  recommendation: Enums<"scorecard_recommendation">;
  comment: string | null;
  scores: ScorecardScore[];
  updatedAt: string;
};

export type CompetencyConsolidation = {
  competency: CompetencyKey;
  label: string;
  average: number | null;
  count: number;
  min: number | null;
  max: number | null;
  /** true si entre evaluadores hay una brecha ≥ DISAGREEMENT_THRESHOLD en esta competencia. */
  disagreement: boolean;
};

export type Consolidation = {
  evaluators: number;
  overall: number | null;
  perCompetency: CompetencyConsolidation[];
  recommendations: Record<Enums<"scorecard_recommendation">, number>;
};

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

/** Consolida las tarjetas del equipo: promedio por competencia, general, desacuerdos y recuento de recomendaciones. */
export function consolidateScorecards(entries: ScorecardEntry[]): Consolidation {
  const perCompetency = SCORECARD_COMPETENCIES.map(({ key, label }) => {
    const values = entries
      .map((entry) => entry.scores.find((score) => score.competency === key)?.score)
      .filter((value): value is number => typeof value === "number");
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    return {
      competency: key,
      label,
      average: mean(values),
      count: values.length,
      min,
      max,
      disagreement: min !== null && max !== null && max - min >= DISAGREEMENT_THRESHOLD,
    };
  });

  const recommendations: Record<Enums<"scorecard_recommendation">, number> = { avanza: 0, duda: 0, no_avanza: 0 };
  for (const entry of entries) recommendations[entry.recommendation] += 1;

  return {
    evaluators: entries.length,
    overall: mean(entries.flatMap((entry) => entry.scores.map((score) => score.score))),
    perCompetency,
    recommendations,
  };
}
