import "server-only";
import { toAppError, AppError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { assembleEvaluation } from "@/modules/evaluation/assemble";
import { evaluateWithRules, RULE_ENGINE_VERSION } from "@/modules/evaluation/rule-engine";
import type { EvaluationResult, RequirementInput } from "@/modules/evaluation/types";

/**
 * Puntuación de un prospecto del Reclutador Caleta.
 *
 * Reutiliza el mismo motor determinista de la evaluación de CV
 * (evaluateWithRules + assembleEvaluation): puntúa un TEXTO de perfil pegado
 * (p. ej. copiado de LinkedIn) contra los requisitos de una vacante, sin
 * necesidad de un CV ni de crear una postulación formal.
 *
 * A diferencia de evaluateApplication, NO exige criterios aprobados: el score
 * Caleta es un apoyo de pre-selección (¿vale la pena contactarlo?), no la
 * evaluación formal del proceso. Al derivar el prospecto a candidato, la
 * evaluación formal se hace por el camino normal.
 */

const MIN_TEXT_LENGTH = 50;

export class ProfileTextUnavailableError extends AppError {
  constructor(message: string) {
    super(message, "validation");
    this.name = "ProfileTextUnavailableError";
  }
}

export type CaletaScore = {
  /** % del peso con requisitos acreditados (0-100), redondeado para la columna `score`. */
  score: number;
  /** Versión de la metodología de puntuación (para la columna `scoring_version`). */
  scoringVersion: string;
  /** Resultado completo (ítems por requisito, nivel, resumen, limitaciones) para `score_detail`. */
  detail: EvaluationResult;
};

/**
 * Puntúa un texto de perfil contra una lista de requisitos ya cargados. Puro y
 * determinista: mismas entradas → mismo resultado.
 */
export function scoreProfileAgainstRequirements(
  profileText: string,
  requirements: RequirementInput[],
  options: { referenceDate?: Date } = {},
): CaletaScore {
  if (requirements.length === 0) {
    throw new AppError("La vacante no tiene requisitos definidos.", "conflict");
  }
  const text = profileText.trim();
  if (text.length < MIN_TEXT_LENGTH) {
    throw new ProfileTextUnavailableError(
      "Pega el texto del perfil (al menos unas líneas) para poder puntuarlo.",
    );
  }
  const items = evaluateWithRules(text, requirements, options);
  const detail = assembleEvaluation({
    method: "reglas",
    methodVersion: RULE_ENGINE_VERSION,
    model: null,
    requirements,
    items,
    textWasCorrected: false,
    textTruncated: false,
  });
  return {
    score: Math.round(detail.scores.score),
    scoringVersion: detail.scoringVersion,
    detail,
  };
}

/**
 * Carga y mapea los requisitos de una vacante al formato del motor
 * (`RequirementInput`). Mismo mapeo que evaluateApplication (service.ts).
 * Lanza si la vacante no tiene requisitos (no se puede puntuar sin ellos).
 */
export async function loadVacancyRequirements(
  supabase: AppSupabaseClient | SupabaseClient<Database>,
  vacancyId: string,
): Promise<RequirementInput[]> {
  const { data: requirementRows, error } = await supabase
    .from("vacancy_requirements")
    .select("id, category, priority, description, keywords, weight, min_years, is_essential")
    .eq("vacancy_id", vacancyId)
    .order("position")
    .order("created_at");
  if (error) throw toAppError(error);
  if (!requirementRows?.length) {
    throw new AppError("La vacante no tiene requisitos definidos.", "conflict");
  }

  return requirementRows.map((r) => ({
    id: r.id,
    category: r.category,
    priority: r.priority,
    description: r.description,
    keywords: r.keywords,
    weight: r.weight,
    minYears: r.min_years,
    isEssential: r.is_essential,
  }));
}

/**
 * Carga los requisitos de la vacante y puntúa el texto del perfil contra ellos.
 */
export async function scoreProfileForVacancy(
  supabase: AppSupabaseClient | SupabaseClient<Database>,
  vacancyId: string,
  profileText: string,
  options: { referenceDate?: Date } = {},
): Promise<CaletaScore> {
  const requirements = await loadVacancyRequirements(supabase, vacancyId);
  return scoreProfileAgainstRequirements(profileText, requirements, options);
}
