import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { summarizeInterviews, type InterviewSummary } from "@/modules/interviews/queries";
import type { Enums } from "@/types/database";
import { MAX_COMPARED, rankCandidates, rankingFacts, type RankInput } from "./ranking";

/** Estados descartados: esas postulaciones no entran a la comparación. */
const EXCLUDED_STATUSES = "(no_seleccionado,retirado)";
/** Cuántas postulaciones (las mejores por puntuación) se ordenan para «los mejores». */
const BEST_POOL_SIZE = 200;
/** Evaluaciones por consulta de ítems, para no toparse con el máximo de filas de la API. */
const ITEMS_CHUNK = 10;

export type CompareItem = {
  evaluation_id: string;
  requirement_id: string | null;
  assessment: Enums<"requirement_assessment">;
  priority: Enums<"requirement_priority">;
  weight: number;
  verification_source: Enums<"verification_source"> | null;
};

export type CompareCandidate = RankInput & {
  name: string;
  status: Enums<"application_status">;
  level: Enums<"compatibility_level">;
  scorePotential: number;
  items: CompareItem[];
  /** Entrevistas de la postulación (la fila «Entrevista» de la tabla). */
  interview: InterviewSummary;
};

/** Postulaciones comparables: con evaluación y no descartadas. */
export async function countComparable(supabase: AppSupabaseClient, vacancyId: string): Promise<number> {
  const { count, error } = await supabase
    .from("application_overview")
    .select("id", { count: "exact", head: true })
    .eq("vacancy_id", vacancyId)
    .not("evaluation_id", "is", null)
    .not("status", "in", EXCLUDED_STATUSES);
  if (error) throw toAppError(error);
  return count ?? 0;
}

async function loadItems(supabase: AppSupabaseClient, evaluationIds: string[]): Promise<CompareItem[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < evaluationIds.length; i += ITEMS_CHUNK) chunks.push(evaluationIds.slice(i, i + ITEMS_CHUNK));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from("candidate_evaluation_items")
        .select("evaluation_id, requirement_id, assessment, priority, weight, verification_source")
        .in("evaluation_id", chunk);
      if (error) throw toAppError(error);
      return data;
    }),
  );
  return results.flat();
}

/**
 * Postulaciones comparables de la vacante, ya ordenadas de la mejor a la peor
 * opción. Con `ids` devuelve exactamente esas (y `missing` si alguna no es
 * comparable o no es de la vacante); con `best` devuelve las `MAX_COMPARED`
 * mejores. Usa el cliente del usuario: la RLS decide qué puede ver.
 */
export async function loadComparison(
  supabase: AppSupabaseClient,
  vacancyId: string,
  selection: { ids: string[] } | { best: true },
): Promise<{ candidates: CompareCandidate[]; missing: boolean }> {
  let query = supabase
    .from("application_overview")
    .select("id, candidate_name, status, applied_at, level, score, score_potential, evaluation_id, evaluation_outdated")
    .eq("vacancy_id", vacancyId)
    .not("evaluation_id", "is", null)
    .not("status", "in", EXCLUDED_STATUSES);
  query =
    "ids" in selection
      ? query.in("id", selection.ids)
      : query.order("score", { ascending: false, nullsFirst: false }).order("applied_at", { ascending: true }).order("id").limit(BEST_POOL_SIZE);
  const { data, error } = await query;
  if (error) throw toAppError(error);

  const rows = data.flatMap((row) =>
    row.id && row.evaluation_id && row.status && row.level && row.score !== null && row.applied_at
      ? [{ ...row, id: row.id, evaluation_id: row.evaluation_id, status: row.status, level: row.level, score: row.score, applied_at: row.applied_at }]
      : [],
  );
  const [items, interviews] = await Promise.all([
    loadItems(supabase, rows.map((row) => row.evaluation_id)),
    summarizeInterviews(supabase, rows.map((row) => row.id)),
  ]);
  const candidates: CompareCandidate[] = rows.map((row) => {
    const own = items.filter((item) => item.evaluation_id === row.evaluation_id);
    const interview = interviews.get(row.id) ?? { lastResult: null, lastScheduledAt: null, nextScheduledAt: null };
    return {
      id: row.id,
      name: row.candidate_name ?? "Candidato",
      status: row.status,
      level: row.level,
      score: row.score,
      scorePotential: row.score_potential ?? row.score,
      evaluationOutdated: Boolean(row.evaluation_outdated),
      appliedAt: row.applied_at,
      items: own,
      interview,
      // 1 si la última entrevista realizada fue «Pasó»; 0 en otro caso.
      interviewScore: interview.lastResult === "paso" ? 1 : 0,
      ...rankingFacts(own),
    };
  });

  const ranked = rankCandidates(candidates);
  if ("ids" in selection) return { candidates: ranked, missing: ranked.length !== selection.ids.length };
  return { candidates: ranked.slice(0, MAX_COMPARED), missing: false };
}
