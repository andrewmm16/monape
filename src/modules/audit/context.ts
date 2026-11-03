import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { collectIds, type AuditContext, type AuditEntry, type AuditLinks } from "./labels";

/**
 * Nombres reales de lo que cada registro toca (vacante, portal, usuario, requisito, candidato).
 * Se leen al mostrar el registro y NO se guardan en el log: así el log no copia datos personales
 * y, si un candidato se elimina, su nombre deja de aparecer.
 * Si una lectura falla, el registro se muestra igual, solo con menos detalle.
 */
const uniq = (values: Iterable<string | null | undefined>): string[] => [...new Set([...values].filter((v): v is string => !!v))];

export async function loadAuditContext(supabase: AppSupabaseClient, entries: readonly AuditEntry[]): Promise<AuditContext> {
  const ctx: AuditContext = { vacancies: {}, portals: {}, candidates: {}, profiles: {}, requirements: {}, links: {} };
  const ids = collectIds(entries);
  const link = (table: string, id: string, value: AuditLinks) => {
    ctx.links[`${table}:${id}`] = value;
  };

  // Ronda 1: lo que cuelga directamente del registro.
  const [pubs, interviews, resumes, evaluations, verifications, consents, items, apps, reqs] = await Promise.all([
    ids.portal_publications.length
      ? supabase.from("portal_publications").select("id, vacancy_id, portal_id").in("id", ids.portal_publications)
      : null,
    ids.interviews.length ? supabase.from("interviews").select("id, application_id").in("id", ids.interviews) : null,
    ids.resumes.length ? supabase.from("resumes").select("id, candidate_id").in("id", ids.resumes) : null,
    ids.candidate_evaluations.length
      ? supabase.from("candidate_evaluations").select("id, application_id").in("id", ids.candidate_evaluations)
      : null,
    ids.requirement_verifications.length
      ? supabase.from("requirement_verifications").select("id, application_id, requirement_id").in("id", ids.requirement_verifications)
      : null,
    ids.consent_records.length ? supabase.from("consent_records").select("id, candidate_id, application_id").in("id", ids.consent_records) : null,
    ids.candidate_profile_items.length
      ? supabase.from("candidate_profile_items").select("id, candidate_id").in("id", ids.candidate_profile_items)
      : null,
    ids.applications.length ? supabase.from("applications").select("id, candidate_id, vacancy_id").in("id", ids.applications) : null,
    ids.vacancy_requirements.length
      ? supabase.from("vacancy_requirements").select("id, vacancy_id, description, category, priority").in("id", ids.vacancy_requirements)
      : null,
  ]);

  for (const row of pubs?.data ?? []) link("portal_publications", row.id, { vacancyId: row.vacancy_id, portalId: row.portal_id });
  for (const row of interviews?.data ?? []) link("interviews", row.id, { applicationId: row.application_id });
  for (const row of resumes?.data ?? []) link("resumes", row.id, { candidateId: row.candidate_id });
  for (const row of evaluations?.data ?? []) link("candidate_evaluations", row.id, { applicationId: row.application_id });
  for (const row of verifications?.data ?? [])
    link("requirement_verifications", row.id, { applicationId: row.application_id, requirementId: row.requirement_id });
  for (const row of consents?.data ?? []) link("consent_records", row.id, { candidateId: row.candidate_id, applicationId: row.application_id });
  for (const row of items?.data ?? []) link("candidate_profile_items", row.id, { candidateId: row.candidate_id });
  for (const row of apps?.data ?? []) link("applications", row.id, { candidateId: row.candidate_id, vacancyId: row.vacancy_id });
  for (const row of reqs?.data ?? []) {
    link("vacancy_requirements", row.id, { vacancyId: row.vacancy_id });
    ctx.requirements[row.id] = { text: row.description, category: row.category, priority: row.priority, vacancyId: row.vacancy_id };
  }

  // Ronda 2: postulaciones y requisitos que solo se conocen por los registros anteriores.
  const moreApps = uniq(Object.values(ctx.links).map((l) => l.applicationId)).filter((id) => !ctx.links[`applications:${id}`]);
  const moreReqs = uniq(Object.values(ctx.links).map((l) => l.requirementId)).filter((id) => !ctx.requirements[id]);
  const [appsB, reqsB] = await Promise.all([
    moreApps.length ? supabase.from("applications").select("id, candidate_id, vacancy_id").in("id", moreApps) : null,
    moreReqs.length ? supabase.from("vacancy_requirements").select("id, vacancy_id, description, category, priority").in("id", moreReqs) : null,
  ]);
  for (const row of appsB?.data ?? []) link("applications", row.id, { candidateId: row.candidate_id, vacancyId: row.vacancy_id });
  for (const row of reqsB?.data ?? []) {
    link("vacancy_requirements", row.id, { vacancyId: row.vacancy_id });
    ctx.requirements[row.id] = { text: row.description, category: row.category, priority: row.priority, vacancyId: row.vacancy_id };
  }

  // Ronda 3: nombres finales.
  const all = Object.values(ctx.links);
  const vacancyIds = uniq([...ids.vacancies, ...all.map((l) => l.vacancyId), ...Object.values(ctx.requirements).map((r) => r.vacancyId)]);
  const candidateIds = uniq([...ids.candidates, ...all.map((l) => l.candidateId)]);
  const portalIds = uniq([...ids.portals, ...all.map((l) => l.portalId)]);
  const profileIds = uniq(ids.profiles);
  const [vacancies, candidates, portals, profiles] = await Promise.all([
    vacancyIds.length ? supabase.from("vacancies").select("id, title, public_code").in("id", vacancyIds) : null,
    candidateIds.length ? supabase.from("candidates").select("id, full_name").in("id", candidateIds) : null,
    portalIds.length ? supabase.from("job_portals").select("id, name").in("id", portalIds) : null,
    profileIds.length ? supabase.from("profiles").select("id, full_name, email, role").in("id", profileIds) : null,
  ]);
  for (const row of vacancies?.data ?? []) ctx.vacancies[row.id] = { title: row.title, code: row.public_code };
  for (const row of candidates?.data ?? []) ctx.candidates[row.id] = row.full_name;
  for (const row of portals?.data ?? []) ctx.portals[row.id] = row.name;
  for (const row of profiles?.data ?? []) ctx.profiles[row.id] = { name: row.full_name, email: row.email ?? "", role: row.role ?? "" };
  return ctx;
}
