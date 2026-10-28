import "server-only";
import { toAppError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppSupabaseClient } from "@/lib/supabase/server";

export async function listPrivacyNotices(supabase: AppSupabaseClient) {
  const { data, error } = await supabase
    .from("privacy_notices")
    .select("id, version, title, body, status, approval_reference, effective_from, created_at")
    .order("version", { ascending: false });
  if (error) throw toAppError(error);
  return data;
}

/** Constancias de consentimiento del candidato, de la más reciente a la más antigua. */
export async function listCandidateConsents(supabase: AppSupabaseClient, candidateId: string) {
  const { data, error } = await supabase
    .from("consent_records")
    .select("id, purpose, granted, method, created_at, revoked_at, notice:privacy_notices(version)")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  if (error) throw toAppError(error);
  return data;
}

export type PublicPrivacyNotice = {
  id: string;
  version: number;
  title: string;
  body: string;
  effectiveFrom: string;
};

/** Aviso vigente para la página pública (función solo de service_role), o null. */
export async function getCurrentPrivacyNotice(): Promise<PublicPrivacyNotice | null> {
  const { data, error } = await createSupabaseAdminClient().rpc("current_privacy_notice");
  if (error) throw toAppError(error);
  const row = data[0];
  if (!row || !row.id || !row.title || !row.body || row.version == null || !row.effective_from) return null;
  return { id: row.id, version: row.version, title: row.title, body: row.body, effectiveFrom: row.effective_from };
}
