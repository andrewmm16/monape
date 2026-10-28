import "server-only";
import { AppError, toAppError } from "@/lib/errors";
import { sanitizeSearchTerm } from "@/lib/search";
import type { AppSupabaseClient } from "@/lib/supabase/server";

export const CANDIDATES_PAGE_SIZE = 25;

export async function listCandidates(supabase: AppSupabaseClient, params: { q: string; page: number }) {
  const from = (params.page - 1) * CANDIDATES_PAGE_SIZE;
  let query = supabase
    .from("candidates")
    .select("id, full_name, email, phone, source, created_at, applications(count)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + CANDIDATES_PAGE_SIZE - 1);
  const term = sanitizeSearchTerm(params.q);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  const { data, error, count } = await query;
  if (error) throw toAppError(error);
  return { rows: data, total: count ?? 0 };
}

export async function getCandidate(supabase: AppSupabaseClient, id: string) {
  const { data, error } = await supabase.from("candidates").select("*").eq("id", id).maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("El candidato no existe o no tiene acceso.", "not_found");
  return data;
}

export async function listResumes(supabase: AppSupabaseClient, candidateId: string) {
  const { data, error } = await supabase
    .from("resumes")
    .select(
      "id, version, original_filename, mime_type, size_bytes, is_current, created_at, uploader:profiles!resumes_uploaded_by_fkey(full_name), resume_extractions(id, status, method, warnings, raw_text, corrected_text, corrected_at, suggested_fields)",
    )
    .eq("candidate_id", candidateId)
    .order("version", { ascending: false });
  if (error) throw toAppError(error);
  return data;
}

export async function listProfileItems(supabase: AppSupabaseClient, candidateId: string) {
  const { data, error } = await supabase
    .from("candidate_profile_items")
    .select("*, verifier:profiles!candidate_profile_items_verified_by_fkey(full_name)")
    .eq("candidate_id", candidateId)
    .order("kind")
    .order("start_date", { ascending: false, nullsFirst: false });
  if (error) throw toAppError(error);
  return data;
}

export async function listCandidateApplications(supabase: AppSupabaseClient, candidateId: string) {
  const { data, error } = await supabase
    .from("application_overview")
    .select("id, vacancy_id, vacancy_title, vacancy_status, status, applied_at, level, score, evaluation_outdated")
    .eq("candidate_id", candidateId)
    .order("applied_at", { ascending: false });
  if (error) throw toAppError(error);
  return data;
}

export async function findDuplicates(
  supabase: AppSupabaseClient,
  values: { email: string | null; phone: string | null; fullName: string; excludeId?: string },
) {
  const { data, error } = await supabase.rpc("find_candidate_duplicates", {
    p_email: values.email,
    p_phone: values.phone,
    p_full_name: values.fullName,
    p_exclude_id: values.excludeId ?? null,
  });
  if (error) throw toAppError(error);
  return data;
}
