import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { type ScorecardEntry, type ScorecardScore } from "./consolidation";

/** Tarjeta de evaluación con la entrevista a la que pertenece. */
export type InterviewScorecardEntry = ScorecardEntry & { interviewId: string };

const SELECT =
  "id, interview_id, evaluator_id, recommendation, comment, scores, updated_at, evaluator:profiles!interview_scorecards_evaluator_id_fkey(full_name)";

function toEntry(row: {
  id: string;
  interview_id: string;
  evaluator_id: string;
  recommendation: ScorecardEntry["recommendation"];
  comment: string | null;
  scores: unknown;
  updated_at: string;
  evaluator: { full_name: string | null } | { full_name: string | null }[] | null;
}): InterviewScorecardEntry {
  const evaluator = Array.isArray(row.evaluator) ? row.evaluator[0] : row.evaluator;
  return {
    id: row.id,
    interviewId: row.interview_id,
    evaluatorId: row.evaluator_id,
    evaluatorName: evaluator?.full_name ?? null,
    recommendation: row.recommendation,
    comment: row.comment,
    scores: Array.isArray(row.scores) ? (row.scores as unknown as ScorecardScore[]) : [],
    updatedAt: row.updated_at,
  };
}

/**
 * Todas las tarjetas de evaluación de las entrevistas de una postulación (las
 * que el usuario puede ver). La página las agrupa por entrevista para el
 * consolidado por ronda y el resumen del candidato.
 */
export async function listApplicationScorecards(
  supabase: AppSupabaseClient,
  applicationId: string,
): Promise<InterviewScorecardEntry[]> {
  const { data, error } = await supabase
    .from("interview_scorecards")
    .select(`${SELECT}, interviews!inner(application_id)`)
    .eq("interviews.application_id", applicationId)
    .order("updated_at", { ascending: true });
  if (error) throw toAppError(error);
  return (data ?? []).map((row) => toEntry(row));
}
