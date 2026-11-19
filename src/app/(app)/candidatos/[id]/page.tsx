import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ApplicationsSection } from "@/components/candidates/applications-section";
import { isCandidatePortalEnabled } from "@/modules/candidate-portal/queries";
import { CandidateDataCard } from "@/components/candidates/candidate-data-card";
import { PrivacySection } from "@/components/candidates/privacy-section";
import { ProfileItemsSection } from "@/components/candidates/profile-items-section";
import { ResumesSection } from "@/components/candidates/resumes-section";
import { PageHeader } from "@/components/common/page-header";
import { ContactHistory } from "@/components/talent/contact-history";
import { ReactivateCandidateDialog } from "@/components/talent/reactivate-candidate-dialog";
import { TalentConsentBadge } from "@/components/talent/talent-consent-badge";
import { TalentTagsManager } from "@/components/talent/talent-tags-manager";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  findDuplicates,
  getCandidate,
  listCandidateApplications,
  listProfileItems,
  listResumes,
} from "@/modules/candidates/queries";
import { listCandidateConsents } from "@/modules/privacy/queries";
import {
  getCandidateConsent,
  getCandidateTags,
  listCandidateContactHistory,
  listReactivableVacancies,
  listTalentTags,
} from "@/modules/talent-pool/queries";
import { listOpenVacancies } from "@/modules/vacancies/queries";

export const metadata: Metadata = { title: "Ficha del candidato" };

export default async function CandidatePage({ params }: PageProps<"/candidatos/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createSupabaseServerClient();
  const candidate = await getCandidate(supabase, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });
  const canManage = can(user.role, "candidates:manage");

  const [
    resumes,
    items,
    applications,
    consents,
    duplicates,
    openVacancies,
    candidateTags,
    allTags,
    talentConsent,
    reactivableVacancies,
    contactHistory,
  ] = await Promise.all([
    listResumes(supabase, candidate.id),
    listProfileItems(supabase, candidate.id),
    listCandidateApplications(supabase, candidate.id),
    listCandidateConsents(supabase, candidate.id),
    canManage
      ? findDuplicates(supabase, { email: candidate.email, phone: candidate.phone, fullName: candidate.full_name, excludeId: candidate.id })
      : Promise.resolve([]),
    canManage ? listOpenVacancies(supabase) : Promise.resolve([]),
    canManage ? getCandidateTags(supabase, candidate.id) : Promise.resolve([]),
    canManage ? listTalentTags(supabase) : Promise.resolve([]),
    canManage ? getCandidateConsent(supabase, candidate.id) : Promise.resolve(null),
    canManage ? listReactivableVacancies(supabase) : Promise.resolve([]),
    canManage ? listCandidateContactHistory(supabase, candidate.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/candidatos" className="hover:underline">
            Candidatos
          </Link>
        }
        title={candidate.full_name}
        description={`Registrado el ${formatDateTime(candidate.created_at)}`}
      />
      {duplicates.length > 0 ? (
        <Alert>
          <AlertTitle>Posibles registros duplicados</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {duplicates.map((duplicate) => (
                <li key={duplicate.id}>
                  <Link href={`/candidatos/${duplicate.id}`} className="underline">
                    {duplicate.full_name}
                  </Link>{" "}
                  (coincide: {duplicate.match_reasons?.join(", ")})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <CandidateDataCard candidate={candidate} canManage={canManage} />
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Etiquetas</CardTitle>
                <CardDescription>Clasifique al candidato en la base de talentos y añádalo a otras vacantes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Consentimiento</span>
                    {talentConsent ? <TalentConsentBadge state={talentConsent} /> : null}
                  </div>
                  <ReactivateCandidateDialog candidateId={candidate.id} vacancies={reactivableVacancies} />
                </div>
                <TalentTagsManager candidateId={candidate.id} tags={candidateTags} allTags={allTags} />
              </CardContent>
            </Card>
          ) : null}
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Historial de contacto</CardTitle>
                <CardDescription>Invitaciones por correo y reactivaciones desde la base de talentos.</CardDescription>
              </CardHeader>
              <CardContent>
                <ContactHistory events={contactHistory} />
              </CardContent>
            </Card>
          ) : null}
          <ApplicationsSection
            candidateId={candidate.id}
            applications={applications}
            openVacancies={openVacancies}
            canManage={can(user.role, "applications:manage")}
            portalEnabled={await isCandidatePortalEnabled(supabase)}
          />
        </div>
        <div className="space-y-6">
          <ResumesSection
            candidateId={candidate.id}
            resumes={resumes}
            canUpload={can(user.role, "resumes:upload")}
            canManage={canManage}
            existingSkills={items.filter((i) => i.kind === "habilidad").map((i) => i.title)}
          />
          <ProfileItemsSection candidateId={candidate.id} items={items} canManage={canManage} />
          <PrivacySection candidateId={candidate.id} consents={consents} canManage={canManage} />
        </div>
      </div>
    </>
  );
}
