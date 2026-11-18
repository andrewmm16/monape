import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { logServerError, toAppError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { EquivalenceVote } from "./ai/response";
import { loadEvaluationContext } from "./context";
import { isLearnableVote, requirementKey, votesFromVerifications, type LearnedRule, type LearnedVerdict } from "./learned";
import { evaluateWithRules } from "./rule-engine";
import type { ItemAssessment, RequirementInput } from "./types";

/**
 * El motor aprende de la IA (lado servidor). Ver learned.ts y la migración
 * 20261118000200_motor_aprende.sql. Nada de esto hace fallar una evaluación:
 * si la base no responde, el motor evalúa como siempre.
 */

type AnyClient = AppSupabaseClient | SupabaseClient<Database>;

/** Reglas activas que aplican a estos requisitos. Nunca lanza: sin reglas, el motor de siempre. */
export async function loadActiveLearnedRules(supabase: AnyClient, requirements: RequirementInput[]): Promise<LearnedRule[]> {
  const keys = [...new Set(requirements.filter((r) => !r.isEssential).map(requirementKey))];
  if (keys.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from("learned_equivalences")
      .select("id, requirement_key, cv_term, cv_term_display, verdict")
      .eq("status", "activa")
      .in("requirement_key", keys);
    if (error) throw error;
    return (data ?? []).flatMap((row) =>
      row.verdict === "equivale" || row.verdict === "no_equivale"
        ? [{ id: row.id, requirementKey: row.requirement_key, term: row.cv_term, termDisplay: row.cv_term_display, verdict: row.verdict as LearnedVerdict }]
        : [],
    );
  } catch (error) {
    logServerError("learning.load_rules", error);
    return [];
  }
}

/** Registra los votos de la IA. Nunca lanza. Devuelve cuántos se registraron. */
export async function recordEquivalenceVotes(
  admin: SupabaseClient<Database>,
  input: {
    candidateId: string;
    applicationId: string;
    requirements: RequirementInput[];
    engineItems: ItemAssessment[];
    votes: EquivalenceVote[];
    minConfirmations: number;
  },
): Promise<number> {
  if (!(input.minConfirmations >= 2)) return 0;
  const requirements = new Map(input.requirements.map((r) => [r.id, r]));
  const engine = new Map(input.engineItems.map((i) => [i.requirementId, i]));
  let recorded = 0;
  for (const vote of input.votes) {
    const requirement = requirements.get(vote.requirementId);
    if (!requirement || requirement.isEssential || !isLearnableVote(engine.get(vote.requirementId), vote.equivalent)) continue;
    try {
      const { error } = await admin.rpc("learn_record_vote", {
        p_requirement_key: requirementKey(requirement),
        p_category: requirement.category,
        p_description: requirement.description,
        p_cv_term: vote.term,
        p_cv_term_display: vote.display,
        p_candidate_id: input.candidateId,
        p_application_id: input.applicationId,
        p_equivalent: vote.equivalent,
        p_rationale: vote.rationale,
        p_min_confirmations: input.minConfirmations,
      });
      if (error) throw error;
      recorded++;
    } catch (error) {
      logServerError("learning.record_vote", error);
    }
  }
  return recorded;
}

/**
 * Tras una verificación de RRHH: lo confirmado como «cumple» donde el motor dudó
 * por un cargo o una habilidad relacionada suma un voto (ver votesFromVerifications).
 * Usa el cliente del sistema (los votos solo los escribe el sistema). Nunca lanza.
 */
export async function learnFromVerifications(
  applicationId: string,
  verified: { requirementId: string; result: "acreditado" | "no_cumplido"; source?: string }[],
): Promise<number> {
  try {
    const minConfirmations = getServerEnv().AI_LEARN_MIN_CONFIRMATIONS;
    if (!(minConfirmations >= 2) || !verified.some((v) => v.result === "acreditado")) return 0;
    const admin = createSupabaseAdminClient();
    const context = await loadEvaluationContext(admin, applicationId);
    // El motor sin reglas aprendidas: la duda y el término tal como los ve el motor base.
    const engineItems = evaluateWithRules(context.fullText, context.requirements, { referenceDate: new Date() });
    const votes = votesFromVerifications(engineItems, verified);
    if (votes.length === 0) return 0;
    return await recordEquivalenceVotes(admin, {
      candidateId: context.candidateId,
      applicationId: context.applicationId,
      requirements: context.requirements,
      engineItems,
      votes,
      minConfirmations,
    });
  } catch (error) {
    logServerError("learning.from_verifications", error);
    return 0;
  }
}

export type LearnedRuleRow = Pick<
  Database["public"]["Tables"]["learned_equivalences"]["Row"],
  | "id"
  | "requirement_category"
  | "requirement_description"
  | "cv_term_display"
  | "verdict"
  | "status"
  | "status_reason"
  | "status_changed_at"
  | "votes_yes"
  | "votes_no"
  | "judge_model"
  | "judge_equivalent"
  | "judge_reason"
  | "activated_at"
  | "updated_at"
>;

export type LearningOverview = {
  rules: LearnedRuleRow[];
  /** Últimas 4 semanas, de la más antigua a la más reciente. */
  weeks: { from: string; engineEvaluations: number; sentToAi: number; resolvedByRules: number }[];
  /** Reglas activas que se activaron en los últimos 7 días. */
  learnedLastWeek: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Lo que el motor aprendió y cuánto depende todavía de la IA (para administración). */
export async function getLearningOverview(supabase: AppSupabaseClient, now = Date.now()): Promise<LearningOverview> {
  const { data: rules, error } = await supabase
    .from("learned_equivalences")
    .select(
      "id, requirement_category, requirement_description, cv_term_display, verdict, status, status_reason, status_changed_at, votes_yes, votes_no, judge_model, judge_equivalent, judge_reason, activated_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw toAppError(error);

  const weeks: LearningOverview["weeks"] = [];
  for (let w = 3; w >= 0; w--) {
    const from = new Date(now - (w + 1) * WEEK_MS).toISOString();
    const to = new Date(now - w * WEEK_MS).toISOString();
    const [engine, ai, byRules] = await Promise.all([
      supabase
        .from("candidate_evaluations")
        .select("id", { count: "exact", head: true })
        .eq("method", "reglas")
        .not("method_version", "like", "%+%")
        .gte("created_at", from)
        .lt("created_at", to),
      supabase
        .from("ai_evaluation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("origin", "automatico")
        .gte("requested_at", from)
        .lt("requested_at", to),
      supabase
        .from("candidate_evaluation_items")
        .select("id, candidate_evaluations!inner(created_at)", { count: "exact", head: true })
        .eq("resolved_by", "regla_aprendida")
        .gte("candidate_evaluations.created_at", from)
        .lt("candidate_evaluations.created_at", to),
    ]);
    for (const r of [engine, ai, byRules]) if (r.error) throw toAppError(r.error);
    weeks.push({ from, engineEvaluations: engine.count ?? 0, sentToAi: ai.count ?? 0, resolvedByRules: byRules.count ?? 0 });
  }
  const learnedLastWeek = (rules ?? []).filter(
    (r) => r.status === "activa" && r.activated_at && Date.parse(r.activated_at) > now - WEEK_MS,
  ).length;
  return { rules: rules ?? [], weeks, learnedLastWeek };
}
