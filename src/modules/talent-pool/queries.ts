import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { TalentFilters } from "./schema";
import { accentInsensitivePattern, normalizeName, splitSkills } from "./text";

export const TALENT_PAGE_SIZE = 25;
/** Tope de candidatos intermedios por filtro (CV/habilidad) para acotar la consulta. */
const ID_SET_LIMIT = 1000;

/** Candidatos cuyo CV vigente contiene el texto (texto corregido tiene prioridad). */
async function candidateIdsByResumeText(supabase: AppSupabaseClient, pattern: string): Promise<string[]> {
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
async function candidateIdsBySkill(supabase: AppSupabaseClient, pattern: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("candidate_profile_items")
    .select("candidate_id")
    .or(`title.ilike.${pattern},description.ilike.${pattern}`)
    .in("kind", ["habilidad", "certificacion", "experiencia"])
    .limit(ID_SET_LIMIT);
  if (error) throw toAppError(error);
  return [...new Set((data ?? []).map((row) => row.candidate_id))];
}

/**
 * Busca en el histórico de candidatos con filtros combinables (AND entre filtros).
 * Usa el cliente del usuario: la RLS decide qué candidatos son visibles.
 */
export async function searchTalentPool(supabase: AppSupabaseClient, filters: TalentFilters) {
  const from = (filters.page - 1) * TALENT_PAGE_SIZE;

  // Conjunto de IDs permitido por los filtros que viven en otras tablas (intersección).
  let allowedIds: string[] | null = null;
  const intersect = (ids: string[]) => {
    allowedIds = allowedIds ? ids.filter((id) => allowedIds!.includes(id)) : ids;
  };

  for (const skill of splitSkills(filters.skills)) {
    intersect(await candidateIdsBySkill(supabase, accentInsensitivePattern(skill)));
    if (allowedIds !== null && (allowedIds as string[]).length === 0) return { rows: [], total: 0 };
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
  return { rows: (data ?? []) as unknown as TalentRow[], total: count ?? 0 };
}

export type TalentRow = {
  id: string;
  full_name: string;
  email: string | null;
  location: string | null;
  source: TalentFilters["source"] & string;
  created_at: string;
  applications: { count: number }[];
};
