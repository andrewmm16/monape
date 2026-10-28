import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/permissions";

/** Solo los perfiles eliminados quedan sin rol (CHECK profiles_role_required). */
function withRole<T extends { role: AppRole | null }>(rows: T[]): (T & { role: AppRole })[] {
  return rows.flatMap((row) => (row.role ? [{ ...row, role: row.role }] : []));
}

/** Usuarios con acceso. Los desactivados están en la papelera. */
export async function listProfiles(supabase: AppSupabaseClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, created_at")
    .eq("is_active", true)
    .order("full_name");
  if (error) throw toAppError(error);
  return withRole(data);
}

/** Papelera: desactivados que aún no se eliminaron definitivamente. */
export async function listTrashedProfiles(supabase: AppSupabaseClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, deactivated_at")
    .eq("is_active", false)
    .is("deleted_at", null)
    .order("deactivated_at", { ascending: false, nullsFirst: false });
  if (error) throw toAppError(error);
  return withRole(data);
}

export async function countTrashedProfiles(supabase: AppSupabaseClient) {
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_active", false)
    .is("deleted_at", null);
  if (error) throw toAppError(error);
  return count ?? 0;
}

/** Usuarios activos para selectores (responsable de la vacante, pedir opinión). */
export async function listActiveProfiles(supabase: AppSupabaseClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("is_active", true)
    .order("full_name");
  if (error) throw toAppError(error);
  return withRole(data);
}
