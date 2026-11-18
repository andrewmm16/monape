import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { RequirementInput } from "./types";

const MIN_TEXT_LENGTH = 50;

export const CRITERIA_NOT_APPROVED_MESSAGE = "Los criterios de la vacante deben estar aprobados por RRHH antes de evaluar.";
export const APPLICATION_NOT_FOUND_MESSAGE = "La postulación no existe o no tiene acceso.";
export const NO_REQUIREMENTS_MESSAGE = "La vacante no tiene requisitos definidos.";

/**
 * La postulación no se puede evaluar porque no hay CV o no hay texto legible
 * (p. ej. un escaneado). Permite distinguirla de otros fallos sin comparar textos.
 */
export class ResumeTextUnavailableError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "ResumeTextUnavailableError";
  }
}

/** Todo lo que se necesita para evaluar una postulación, leído de la base de datos. */
export type EvaluationContext = {
  applicationId: string;
  vacancyTitle: string;
  criteriaVersion: number;
  requirements: RequirementInput[];
  resumeId: string;
  /** Texto del CV (el corregido por RRHH si existe), sin espacios en los extremos. */
  fullText: string;
  textWasCorrected: boolean;
};

/**
 * Carga la postulación, los criterios aprobados de su vacante y el texto del CV
 * que corresponde evaluar. Lo usan la evaluación directa y la cola de IA, para
 * que ambas evalúen exactamente lo mismo.
 */
export async function loadEvaluationContext(
  supabase: AppSupabaseClient | SupabaseClient<Database>,
  applicationId: string,
): Promise<EvaluationContext> {
  const { data: application, error } = await supabase
    .from("applications")
    .select("id, candidate_id, resume_id, vacancies(id, title, criteria_version, criteria_approved_at)")
    .eq("id", applicationId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!application?.vacancies) throw new AppError(APPLICATION_NOT_FOUND_MESSAGE, "not_found");

  const vacancy = application.vacancies;
  if (!vacancy.criteria_approved_at) {
    throw new AppError(CRITERIA_NOT_APPROVED_MESSAGE, "conflict");
  }

  const { data: requirementRows, error: requirementsError } = await supabase
    .from("vacancy_requirements")
    .select("id, category, priority, description, keywords, weight, min_years, is_essential")
    .eq("vacancy_id", vacancy.id)
    .order("position")
    .order("created_at");
  if (requirementsError) throw toAppError(requirementsError);
  if (!requirementRows?.length) throw new AppError(NO_REQUIREMENTS_MESSAGE, "conflict");

  const requirements: RequirementInput[] = requirementRows.map((r) => ({
    id: r.id,
    category: r.category,
    priority: r.priority,
    description: r.description,
    keywords: r.keywords,
    weight: r.weight,
    minYears: r.min_years,
    isEssential: r.is_essential,
  }));

  // Se evalúa el CV asociado a la postulación (o el vigente si aún no tiene
  // uno): una carga posterior no cambia lo evaluado sin decisión de RRHH.
  let resumeQuery = supabase
    .from("resumes")
    .select("id, resume_extractions(raw_text, corrected_text)")
    .eq("candidate_id", application.candidate_id);
  resumeQuery = application.resume_id ? resumeQuery.eq("id", application.resume_id) : resumeQuery.eq("is_current", true);
  const { data: resume, error: resumeError } = await resumeQuery.maybeSingle();
  if (resumeError) throw toAppError(resumeError);
  if (!resume) throw new ResumeTextUnavailableError("El candidato no tiene un CV cargado.");

  const extraction = resume.resume_extractions;
  const textWasCorrected = Boolean(extraction?.corrected_text);
  const fullText = (extraction?.corrected_text ?? extraction?.raw_text ?? "").trim();
  if (fullText.length < MIN_TEXT_LENGTH) {
    throw new ResumeTextUnavailableError(
      "No hay texto legible del CV. Revise la extracción o transcriba el contenido en la ficha del candidato.",
    );
  }

  return {
    applicationId: application.id,
    vacancyTitle: vacancy.title,
    criteriaVersion: vacancy.criteria_version,
    requirements,
    resumeId: resume.id,
    fullText,
    textWasCorrected,
  };
}
