import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { type ScorecardEntry, type ScorecardScore } from "./consolidation";

/** Tarjetas de evaluación del equipo para una postulación (todas las que el usuario puede ver). */
export async function listScorecards(supabase: AppSupabaseClient, applicationId: string): Promise<ScorecardEntry[]> {
  const { data, error } = await supabase
    .from("application_scorecards")
    .select(
      "id, evaluator_id, recommendation, comment, scores, updated_at, evaluator:profiles!application_scorecards_evaluator_id_fkey(full_name)",
    )
    .eq("application_id", applicationId)
    .order("updated_at", { ascending: true });
  if (error) throw toAppError(error);

  return (data ?? []).map((row) => {
    const evaluator = Array.isArray(row.evaluator) ? row.evaluator[0] : row.evaluator;
    return {
      id: row.id,
      evaluatorId: row.evaluator_id,
      evaluatorName: (evaluator as { full_name: string | null } | null)?.full_name ?? null,
      recommendation: row.recommendation,
      comment: row.comment,
      scores: Array.isArray(row.scores) ? (row.scores as unknown as ScorecardScore[]) : [],
      updatedAt: row.updated_at,
    };
  });
}
