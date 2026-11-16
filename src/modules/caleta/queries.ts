import "server-only";
import { toAppError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { Database, Enums, Tables } from "@/types/database";

type Client = AppSupabaseClient | SupabaseClient<Database>;

export type CaletaVacancy = { id: string; title: string; department: string };

export type CaletaRequirement = Pick<
  Tables<"vacancy_requirements">,
  "id" | "description" | "priority" | "category" | "is_essential" | "min_years"
>;

export type CaletaProspect = Tables<"caleta_prospects">;

/** Vacantes activas (no archivadas) que tienen al menos un requisito, para poder puntuar. */
export async function listCaletaVacancies(supabase: Client): Promise<CaletaVacancy[]> {
  const { data, error } = await supabase
    .from("vacancies")
    .select("id, title, department, vacancy_requirements(count)")
    .neq("status", "archivada")
    .order("title");
  if (error) throw toAppError(error);
  return (data ?? [])
    .filter((v) => (v.vacancy_requirements?.[0]?.count ?? 0) > 0)
    .map((v) => ({ id: v.id, title: v.title, department: v.department }));
}

/** Requisitos de la vacante, para dibujar el checklist del prospecto. */
export async function listVacancyRequirements(supabase: Client, vacancyId: string): Promise<CaletaRequirement[]> {
  const { data, error } = await supabase
    .from("vacancy_requirements")
    .select("id, description, priority, category, is_essential, min_years")
    .eq("vacancy_id", vacancyId)
    .order("position")
    .order("created_at");
  if (error) throw toAppError(error);
  return data ?? [];
}

/**
 * Cuántos prospectos se contactaron por un canal desde `since`, en todas las
 * vacantes. Con LinkedIn gratuito el tope es semanal (~100 invitaciones), así
 * que el panel lo cuenta en una ventana móvil de 7 días.
 */
export async function countContactedSince(
  supabase: Client,
  channel: Enums<"caleta_contact_channel">,
  since: Date,
): Promise<number> {
  const { count, error } = await supabase
    .from("caleta_prospects")
    .select("id", { count: "exact", head: true })
    .eq("contact_channel", channel)
    .gte("contacted_at", since.toISOString());
  if (error) throw toAppError(error);
  return count ?? 0;
}

/** Prospectos de una vacante, mejor puntuados primero. */
export async function listProspects(supabase: Client, vacancyId: string): Promise<CaletaProspect[]> {
  const { data, error } = await supabase
    .from("caleta_prospects")
    .select("*")
    .eq("vacancy_id", vacancyId)
    .order("score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw toAppError(error);
  return data ?? [];
}
