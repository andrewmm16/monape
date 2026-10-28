import "server-only";
import { AppError, toAppError } from "@/lib/errors";
import { sanitizeSearchTerm } from "@/lib/search";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export async function listVacancies(
  supabase: AppSupabaseClient,
  filters: { status?: Enums<"vacancy_status"> | ""; q?: string },
) {
  let query = supabase
    .from("vacancies")
    .select(
      "id, title, department, status, modality, location, opening_date, closing_date, criteria_version, criteria_approved_at, created_at, owner:profiles!vacancies_owner_id_fkey(full_name), applications(count)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (filters.status) query = query.eq("status", filters.status);
  else query = query.neq("status", "archivada");
  if (filters.q) {
    const term = sanitizeSearchTerm(filters.q);
    if (term) query = query.or(`title.ilike.%${term}%,department.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

export async function getVacancy(supabase: AppSupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("vacancies")
    .select(
      "*, owner:profiles!vacancies_owner_id_fkey(id, full_name), approver:profiles!vacancies_criteria_approved_by_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("La vacante no existe o no tiene acceso.", "not_found");
  return data;
}

export async function listRequirements(supabase: AppSupabaseClient, vacancyId: string) {
  const { data, error } = await supabase
    .from("vacancy_requirements")
    .select("*")
    .eq("vacancy_id", vacancyId)
    .order("position")
    .order("created_at");
  if (error) throw toAppError(error);
  return data;
}

/** Vacantes que admiten nuevas postulaciones (para asociar candidatos). */
export async function listOpenVacancies(supabase: AppSupabaseClient) {
  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, department, status")
    .in("status", ["borrador", "publicada"])
    .order("title");
  if (error) throw toAppError(error);
  return data;
}
