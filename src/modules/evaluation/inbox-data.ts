import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";
import { buildInbox, type Inbox, type InboxCandidate } from "./inbox";
import { loadInterviewGuides } from "./interview-guide-data";

/** Los estados «en proceso» (como private.is_application_in_process). */
const IN_PROCESS: Enums<"application_status">[] = ["nuevo", "en_revision", "preseleccionado", "entrevista_programada", "en_evaluacion"];
const MAX_APPLICATIONS = 1000;

/** Bandeja de la vacante: candidatos en proceso agrupados por lo que hace falta hacer. Respeta la RLS. */
export async function loadVacancyInbox(supabase: AppSupabaseClient, vacancyId: string): Promise<Inbox> {
  const { data: applications, error } = await supabase
    .from("applications")
    .select("id, vacancy_id, status, latest_evaluation_id, candidates(full_name)")
    .eq("vacancy_id", vacancyId)
    .in("status", IN_PROCESS)
    .limit(MAX_APPLICATIONS);
  if (error) throw toAppError(error);
  const evaluated = applications.filter((a) => a.latest_evaluation_id);

  const scores = new Map<string, { score: number; potential: number }>();
  const ids = evaluated.map((a) => a.latest_evaluation_id!);
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error: scoreError } = await supabase
      .from("candidate_evaluations")
      .select("id, score, score_potential")
      .in("id", ids.slice(i, i + 100));
    if (scoreError) throw toAppError(scoreError);
    for (const row of data ?? []) scores.set(row.id, { score: Number(row.score), potential: Number(row.score_potential) });
  }

  const guides = await loadInterviewGuides(supabase, evaluated);
  const candidates: InboxCandidate[] = evaluated.flatMap((a) => {
    const score = scores.get(a.latest_evaluation_id!);
    const guide = guides.get(a.id);
    return score && guide
      ? [{ applicationId: a.id, candidateName: a.candidates?.full_name ?? "Sin nombre", status: a.status, ...score, guide }]
      : [];
  });
  return buildInbox(candidates, applications.length - evaluated.length);
}
