import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { IN_PROCESS_STATUSES } from "@/modules/applications/schemas";
import {
  candidateIdsByResumeText,
  candidateIdsBySkill,
  consentByCandidate,
  type TalentConsentState,
} from "./queries";
import { accentInsensitivePattern } from "./text";

const MAX_TERMS = 12;
const MAX_SUGGESTIONS = 50;

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
  matchCount: number;
  matchedTerms: string[];
  consent: TalentConsentState;
};

/**
 * Sugiere candidatos del histórico que encajan con una vacante, por
 * habilidades/requisitos (no por el motor de afinidad). Solo candidatos
 * DISPONIBLES (sin postulación en proceso) y que no estén ya en esta vacante.
 * Ordenados por número de coincidencias. Usa el cliente del usuario: la RLS
 * decide qué candidatos son visibles.
 */
export async function suggestCandidatesForVacancy(
  supabase: AppSupabaseClient,
  vacancyId: string,
): Promise<SuggestedCandidate[]> {
  // 1. Requisitos → términos de búsqueda.
  const { data: reqs, error: reqError } = await supabase
    .from("vacancy_requirements")
    .select("description")
    .eq("vacancy_id", vacancyId);
  if (reqError) throw toAppError(reqError);
  const terms = extractRequirementTerms((reqs ?? []).map((r) => r.description));
  if (terms.length === 0) return [];

  // 2. Coincidencias por término (habilidades + texto del CV), acumuladas por candidato.
  const matched = new Map<string, Set<string>>();
  for (const term of terms) {
    const pattern = accentInsensitivePattern(term);
    if (!pattern) continue;
    const [bySkill, byText] = await Promise.all([
      candidateIdsBySkill(supabase, pattern),
      candidateIdsByResumeText(supabase, pattern),
    ]);
    for (const id of new Set([...bySkill, ...byText])) {
      const set = matched.get(id) ?? new Set<string>();
      set.add(term);
      matched.set(id, set);
    }
  }
  const matchedIds = [...matched.keys()];
  if (matchedIds.length === 0) return [];

  // 3. Disponibilidad: fuera si tiene postulación en proceso o ya está en esta vacante.
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
  const availableIds = matchedIds.filter((id) => !blocked.has(id));
  if (availableIds.length === 0) return [];

  // 4. Datos de los candidatos + consentimiento de cartera.
  const [{ data: candidates, error: candError }, consent] = await Promise.all([
    supabase.from("candidates").select("id, full_name, email, location").in("id", availableIds),
    consentByCandidate(supabase, availableIds),
  ]);
  if (candError) throw toAppError(candError);

  const rows: SuggestedCandidate[] = (candidates ?? []).map((candidate) => {
    const matchedTerms = [...(matched.get(candidate.id) ?? [])];
    return {
      id: candidate.id,
      full_name: candidate.full_name,
      email: candidate.email,
      location: candidate.location,
      matchCount: matchedTerms.length,
      matchedTerms,
      consent: consent.get(candidate.id) ?? "sin",
    };
  });
  rows.sort((a, b) => b.matchCount - a.matchCount || a.full_name.localeCompare(b.full_name));
  return rows.slice(0, MAX_SUGGESTIONS);
}
