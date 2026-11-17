import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { TalentFilters } from "./schema";
import { accentInsensitivePattern, normalizeName, splitSkills } from "./text";

export const TALENT_PAGE_SIZE = 25;
/** Tope de candidatos intermedios por filtro (CV/habilidad/etiqueta) para acotar la consulta. */
const ID_SET_LIMIT = 1000;

export type TalentTag = { id: string; name: string; color: string | null };
/** Estado del consentimiento de cartera de talento del candidato (señal informativa). */
export type TalentConsentState = "consiente" | "revocado" | "sin";

/** Candidatos cuyo CV vigente contiene el texto (texto corregido tiene prioridad). */
export async function candidateIdsByResumeText(supabase: AppSupabaseClient, pattern: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("resume_extractions")
    .select("resumes!inner(candidate_id, is_current)")
    .eq("resumes.is_current", true)
    .or(`corrected_text.ilike.${pattern},and(corrected_text.is.null,raw_text.ilike.${pattern})`)
    .limit(ID_SET_LIMIT);
  if (error) throw toAppError(error);
  return (data ?? []).flatMap((row) => {
    const resume = Array.isArray(row.resumes) ? row.resumes[0] : row.resumes;
    return resume ? [resume.candidate_id] : [];
  });
}

/** Candidatos con un ítem de perfil (habilidad, experiencia, certificación...) que coincide. */
export async function candidateIdsBySkill(supabase: AppSupabaseClient, pattern: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("candidate_profile_items")
    .select("candidate_id")
    .or(`title.ilike.${pattern},description.ilike.${pattern}`)
    .in("kind", ["habilidad", "certificacion", "experiencia"])
    .limit(ID_SET_LIMIT);
  if (error) throw toAppError(error);
  return [...new Set((data ?? []).map((row) => row.candidate_id))];
}

/** Candidatos que tienen una etiqueta concreta. */
async function candidateIdsByTag(supabase: AppSupabaseClient, tagId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("candidate_tags")
    .select("candidate_id")
    .eq("tag_id", tagId)
    .limit(ID_SET_LIMIT);
  if (error) throw toAppError(error);
  return [...new Set((data ?? []).map((row) => row.candidate_id))];
}

/** Todas las etiquetas del equipo, por nombre. */
export async function listTalentTags(supabase: AppSupabaseClient): Promise<TalentTag[]> {
  const { data, error } = await supabase.from("talent_tags").select("id, name, color").order("name");
  if (error) throw toAppError(error);
  return data ?? [];
}

export type ReactivableVacancy = { id: string; title: string; status: string };

/** Vacantes a las que se puede reactivar un candidato (abiertas: publicada o borrador). */
export async function listReactivableVacancies(supabase: AppSupabaseClient): Promise<ReactivableVacancy[]> {
  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, status")
    .in("status", ["publicada", "borrador"])
    .order("title")
    .limit(300);
  if (error) throw toAppError(error);
  return data ?? [];
}

/** Etiquetas por candidato (para enriquecer el listado). */
async function tagsByCandidate(supabase: AppSupabaseClient, ids: string[]): Promise<Map<string, TalentTag[]>> {
  const map = new Map<string, TalentTag[]>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("candidate_tags")
    .select("candidate_id, talent_tags(id, name, color)")
    .in("candidate_id", ids);
  if (error) throw toAppError(error);
  for (const row of data ?? []) {
    const tag = Array.isArray(row.talent_tags) ? row.talent_tags[0] : row.talent_tags;
    if (!tag) continue;
    const list = map.get(row.candidate_id) ?? [];
    list.push(tag as TalentTag);
    map.set(row.candidate_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/** Estado de consentimiento de cartera por candidato (la constancia más reciente manda). */
export async function consentByCandidate(
  supabase: AppSupabaseClient,
  ids: string[],
): Promise<Map<string, TalentConsentState>> {
  const map = new Map<string, TalentConsentState>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("consent_records")
    .select("candidate_id, granted, revoked_at, created_at")
    .eq("purpose", "cartera_talento")
    .in("candidate_id", ids)
    .order("created_at", { ascending: false });
  if (error) throw toAppError(error);
  for (const row of data ?? []) {
    if (map.has(row.candidate_id)) continue; // la primera es la más reciente
    map.set(row.candidate_id, row.granted ? (row.revoked_at ? "revocado" : "consiente") : "sin");
  }
  return map;
}

/** Etiquetas de un candidato (ficha). */
export async function getCandidateTags(supabase: AppSupabaseClient, candidateId: string): Promise<TalentTag[]> {
  return (await tagsByCandidate(supabase, [candidateId])).get(candidateId) ?? [];
}

/** Consentimiento de cartera de un candidato (ficha). */
export async function getCandidateConsent(
  supabase: AppSupabaseClient,
  candidateId: string,
): Promise<TalentConsentState> {
  return (await consentByCandidate(supabase, [candidateId])).get(candidateId) ?? "sin";
}

export type TalentRow = {
  id: string;
  full_name: string;
  email: string | null;
  location: string | null;
  source: TalentFilters["source"] & string;
  created_at: string;
  applications: { count: number }[];
  tags: TalentTag[];
  consent: TalentConsentState;
};

/**
 * Busca en el histórico de candidatos con filtros combinables (AND entre filtros).
 * Usa el cliente del usuario: la RLS decide qué candidatos son visibles. Cada fila
 * se enriquece con sus etiquetas y el estado de consentimiento de cartera.
 */
export async function searchTalentPool(supabase: AppSupabaseClient, filters: TalentFilters) {
  const from = (filters.page - 1) * TALENT_PAGE_SIZE;

  // Conjunto de IDs permitido por los filtros que viven en otras tablas (intersección).
  let allowedIds: string[] | null = null;
  const intersect = (ids: string[]) => {
    allowedIds = allowedIds ? ids.filter((id) => allowedIds!.includes(id)) : ids;
  };
  const emptyResult = { rows: [] as TalentRow[], total: 0 };

  for (const skill of splitSkills(filters.skills)) {
    intersect(await candidateIdsBySkill(supabase, accentInsensitivePattern(skill)));
    if (allowedIds !== null && (allowedIds as string[]).length === 0) return emptyResult;
  }

  if (filters.tag) {
    intersect(await candidateIdsByTag(supabase, filters.tag));
    if (allowedIds !== null && (allowedIds as string[]).length === 0) return emptyResult;
  }

  const textPattern = accentInsensitivePattern(filters.q);
  let textIds: string[] = [];
  if (textPattern) textIds = await candidateIdsByResumeText(supabase, textPattern);

  const statusFilter = Boolean(filters.status);
  let query = supabase
    .from("candidates")
    .select(
      statusFilter
        ? "id, full_name, email, location, source, created_at, filter_apps:applications!inner(status), applications(count)"
        : "id, full_name, email, location, source, created_at, applications(count)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + TALENT_PAGE_SIZE - 1);

  if (textPattern) {
    const name = normalizeName(filters.q).replace(/\s/g, "%");
    const clauses = [`name_normalized.ilike.%${name}%`];
    if (textIds.length > 0) clauses.push(`id.in.(${textIds.join(",")})`);
    query = query.or(clauses.join(","));
  }
  if (allowedIds !== null) {
    const ids: string[] = allowedIds;
    query = query.in("id", ids);
  }
  if (filters.source) query = query.eq("source", filters.source);
  const location = accentInsensitivePattern(filters.location);
  if (location) query = query.ilike("location", location);
  if (filters.status) query = query.eq("filter_apps.status", filters.status);

  const { data, error, count } = await query;
  if (error) throw toAppError(error);

  const base = (data ?? []) as unknown as Omit<TalentRow, "tags" | "consent">[];
  const ids = base.map((row) => row.id);
  const [tags, consent] = await Promise.all([tagsByCandidate(supabase, ids), consentByCandidate(supabase, ids)]);
  const rows: TalentRow[] = base.map((row) => ({
    ...row,
    tags: tags.get(row.id) ?? [],
    consent: consent.get(row.id) ?? "sin",
  }));
  return { rows, total: count ?? 0 };
}
