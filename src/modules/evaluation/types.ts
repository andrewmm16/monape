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
  /** Palabras del CV (tal como están escritas) que dieron origen a este extracto. */
  matched?: string[];
};

/**
 * Duda concreta del motor de reglas sobre un requisito, en forma legible por código.
 * Marca los casos en los que el motor sabe que su lectura es limitada y una segunda
 * opinión (IA o persona) aporta: por ejemplo, decidir si un cargo parecido equivale
 * al pedido. No cambia el veredicto ni el puntaje.
 *  - `cargo_relacionado`: no está el cargo pedido, sí uno parecido (reglas-v10).
 *  - `habilidad_relacionada`: no está la habilidad pedida, sí una más general o
 *    vecina (reglas-v10).
 *  - `mencion_dudosa`: el término solo aparece negado, como interés, atribuido a otra
 *    persona o en un enlace; el contexto decide.
 *  - `nivel_inferior`: declara un nivel por debajo del pedido (o un rango desde básico).
 *  - `nivel_no_declarado`: menciona la habilidad o el idioma sin nivel.
 *  - `fechas_no_cuadran`: declara más años de los que suman sus fechas.
 */
export type EngineSignal =
  | "cargo_relacionado"
  | "habilidad_relacionada"
  | "mencion_dudosa"
  | "nivel_inferior"
  | "nivel_no_declarado"
  | "fechas_no_cuadran";

export type ItemAssessment = {
  requirementId: string;
  assessment: Assessment;
  evidence: Evidence[];
  rationale: string;
  /** Duda concreta del motor (ver EngineSignal). Solo en memoria: no se persiste. */
  signal?: EngineSignal;
  /** Con una verificación de RRHH: lo que dio el CV (o el motor) antes de aplicarla. */
  cvAssessment?: Assessment;
  /** Con una verificación de RRHH: el motivo original del CV (o del motor). */
  cvRationale?: string;
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
