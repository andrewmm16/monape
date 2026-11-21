import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { IN_PROCESS_STATUSES } from "@/modules/applications/schemas";
import { loadActiveLearnedRules } from "@/modules/evaluation/learning";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import type { RequirementInput } from "@/modules/evaluation/types";
import {
  candidateIdsByResumeText,
  candidateIdsBySkill,
  consentByCandidate,
  sentInvitationsForVacancy,
  type SentInvitation,
  type TalentConsentState,
} from "./queries";
import { accentInsensitivePattern } from "./text";
import { rankTalent, resumeTextOf, type RankedTalent } from "./ranking";

const MAX_TERMS = 12;

/** Palabras funcionales/genéricas que no sirven como término de búsqueda. */
const STOPWORDS = new Set([
  "para", "con", "los", "las", "del", "una", "que", "por", "como", "experiencia", "conocimiento",
  "conocimientos", "manejo", "capacidad", "nivel", "area", "área", "trabajo", "gestion", "gestión",
  "uso", "sobre", "entre", "desde", "hasta", "muy", "mas", "más", "sus", "este", "esta", "año", "años",
  "minimo", "mínimo", "deseable", "requisito", "requisitos", "habilidad", "habilidades",
]);

/** Extrae términos buscables (palabras significativas) de las descripciones de requisitos. */
export function extractRequirementTerms(descriptions: string[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const description of descriptions) {
    for (const raw of description.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      const term = raw.trim();
      if (term.length < 4 || STOPWORDS.has(term) || seen.has(term)) continue;
      seen.add(term);
      terms.push(term);
      if (terms.length >= MAX_TERMS) return terms;
    }
  }
  return terms;
}

export type SuggestedCandidate = {
  id: string;
  full_name: string;
  email: string | null;
  location: string | null;
  /** % de requisitos (por peso) que el motor acredita en su CV para esta vacante. */
  score: number;
  level: RankedTalent["level"];
  mandatoryMet: number;
  mandatoryTotal: number;
  /** Obligatorios que su CV no acredita. */
  missingMandatory: string[];
  consent: TalentConsentState;
  /** Invitación ya enviada para ESTA vacante (si la hay). */
  invitation: SentInvitation | null;
};

/** Personas evaluadas con el motor por vacante (las de más coincidencias de términos). */
const MAX_EVALUATED = 200;

/**
 * Sugiere personas del histórico para una vacante, evaluando su CV con el
 * mismo motor de reglas de las postulaciones (sin IA y sin guardar nada). Solo
 * personas DISPONIBLES: sin postulación en proceso, que no estén ya en esta
 * vacante y no anonimizadas. Para acotar el costo, primero se prefiltra por los
 * términos de los requisitos (descripción y palabras clave). Usa el cliente del
 * usuario: la RLS decide qué candidatos son visibles.
 */
export async function suggestCandidatesForVacancy(
  supabase: AppSupabaseClient,
  vacancyId: string,
): Promise<SuggestedCandidate[]> {
  // 1. Requisitos de la vacante: para el motor y para los términos del prefiltro.
  const { data: reqs, error: reqError } = await supabase
    .from("vacancy_requirements")
    .select("id, category, priority, description, keywords, weight, min_years, is_essential, position")
    .eq("vacancy_id", vacancyId)
    .order("position");
  if (reqError) throw toAppError(reqError);
  const requirements: RequirementInput[] = (reqs ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    priority: r.priority,
    description: r.description,
    keywords: r.keywords ?? [],
    weight: r.weight,
    minYears: r.min_years,
    isEssential: r.is_essential,
  }));
  if (requirements.length === 0) return [];
  const terms = extractRequirementTerms(requirements.flatMap((r) => [r.description, ...r.keywords]));
  if (terms.length === 0) return [];

  // 2. Prefiltro: coincidencias por término (habilidades + texto del CV), acumuladas por candidato.
  const matched = new Map<string, number>();
  for (const term of terms) {
    const pattern = accentInsensitivePattern(term);
    if (!pattern) continue;
    const [bySkill, byText] = await Promise.all([
      candidateIdsBySkill(supabase, pattern),
      candidateIdsByResumeText(supabase, pattern),
    ]);
    for (const id of new Set([...bySkill, ...byText])) matched.set(id, (matched.get(id) ?? 0) + 1);
  }
  if (matched.size === 0) return [];

  // 3. Disponibilidad: fuera si tiene postulación en proceso o ya está en esta vacante.
  const matchedIds = [...matched.keys()];
  const { data: apps, error: appsError } = await supabase
    .from("applications")
    .select("candidate_id, vacancy_id, status")
    .in("candidate_id", matchedIds);
  if (appsError) throw toAppError(appsError);
  const inProcess = new Set(IN_PROCESS_STATUSES as readonly string[]);
  const blocked = new Set<string>();
  for (const app of apps ?? []) {
    if (app.vacancy_id === vacancyId || inProcess.has(app.status)) blocked.add(app.candidate_id);
  }
  const shortlist = matchedIds
    .filter((id) => !blocked.has(id))
    .sort((a, b) => (matched.get(b) ?? 0) - (matched.get(a) ?? 0))
    .slice(0, MAX_EVALUATED);
  if (shortlist.length === 0) return [];

  // 4. Personas (sin anonimizar) y el texto de su CV vigente.
  const [{ data: people, error: peopleError }, { data: resumes, error: resumesError }] = await Promise.all([
    supabase.from("candidates").select("id, full_name, email, location").in("id", shortlist).is("anonymized_at", null),
    supabase
      .from("resumes")
      .select("candidate_id, resume_extractions(raw_text, corrected_text)")
      .in("candidate_id", shortlist)
      .eq("is_current", true),
  ]);
  if (peopleError) throw toAppError(peopleError);
  if (resumesError) throw toAppError(resumesError);
  const textByCandidate = new Map<string, string>();
  for (const resume of resumes ?? []) {
    const text = resumeTextOf(resume.resume_extractions);
    if (text) textByCandidate.set(resume.candidate_id, text);
  }

  // 5. Motor de reglas (con lo que ya aprendió) y orden.
  const learned = await loadActiveLearnedRules(supabase, requirements);
  const referenceDate = new Date();
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const ranked = rankTalent(
    [...personById.values()].flatMap((person) => {
      const text = textByCandidate.get(person.id);
      if (!text) return [];
      return [{ candidateId: person.id, name: person.full_name, requirements, items: evaluateWithRules(text, requirements, { referenceDate, learned }) }];
    }),
  );
  if (ranked.length === 0) return [];

  // 6. Consentimiento de cartera e invitaciones ya enviadas.
  const rankedIds = ranked.map((r) => r.candidateId);
  const [consent, invitations] = await Promise.all([
    consentByCandidate(supabase, rankedIds),
    sentInvitationsForVacancy(supabase, vacancyId, rankedIds),
  ]);
  return ranked.map((talent) => {
    const person = personById.get(talent.candidateId)!;
    return {
      id: person.id,
      full_name: person.full_name,
      email: person.email,
      location: person.location,
      score: talent.score,
      level: talent.level,
      mandatoryMet: talent.mandatoryMet,
      mandatoryTotal: talent.mandatoryTotal,
      missingMandatory: talent.missingMandatory,
      consent: consent.get(person.id) ?? "sin",
      invitation: invitations.get(person.id) ?? null,
    };
  });
}
