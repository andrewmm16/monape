import type { Enums } from "@/types/database";

export type Assessment = Enums<"requirement_assessment">;
export type CompatibilityLevel = Enums<"compatibility_level">;
export type EvaluationMethod = Enums<"evaluation_method">;

export type RequirementInput = {
  id: string;
  category: Enums<"requirement_category">;
  priority: Enums<"requirement_priority">;
  description: string;
  keywords: string[];
  weight: number;
  minYears: number | null;
  isEssential: boolean;
};

/** Fragmento del CV que sustenta una valoración. `start`/`end` refieren al texto evaluado. */
export type Evidence = {
  quote: string;
  start?: number;
  end?: number;
};

export type ItemAssessment = {
  requirementId: string;
  assessment: Assessment;
  evidence: Evidence[];
  rationale: string;
};

export type Scores = {
  /** % del peso con requisitos acreditados. */
  score: number;
  /** % máximo alcanzable si se acreditaran los requisitos sin evidencia o pendientes. */
  potential: number;
  /** % del peso con evidencia determinante (acreditado o no cumplido). */
  coverage: number;
  /** % del peso sin evidencia o pendiente de verificación. */
  unknown: number;
  /** % del peso aparentemente no cumplido. */
  notMet: number;
};

export type EvaluationResult = {
  method: EvaluationMethod;
  methodVersion: string;
  scoringVersion: string;
  model: string | null;
  items: ItemAssessment[];
  scores: Scores;
  level: CompatibilityLevel;
  summary: string;
  limitations: string[];
};
