import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ApplicationsSection } from "@/components/candidates/applications-section";
import { CandidateDataCard } from "@/components/candidates/candidate-data-card";
import { PrivacySection } from "@/components/candidates/privacy-section";
import { ProfileItemsSection } from "@/components/candidates/profile-items-section";
import { ResumesSection } from "@/components/candidates/resumes-section";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

  const [resumes, items, applications, consents, duplicates, openVacancies] = await Promise.all([
    listResumes(supabase, candidate.id),
    listProfileItems(supabase, candidate.id),
    listCandidateApplications(supabase, candidate.id),
    listCandidateConsents(supabase, candidate.id),
    canManage
      ? findDuplicates(supabase, { email: candidate.email, phone: candidate.phone, fullName: candidate.full_name, excludeId: candidate.id })
      : Promise.resolve([]),
    canManage ? listOpenVacancies(supabase) : Promise.resolve([]),
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
          <ApplicationsSection
            candidateId={candidate.id}
            applications={applications}
            openVacancies={openVacancies}
            canManage={can(user.role, "applications:manage")}
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
