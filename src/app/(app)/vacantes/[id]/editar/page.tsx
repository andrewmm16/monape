import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { VacancyForm } from "@/components/vacancies/vacancy-form";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveProfiles } from "@/modules/users/queries";
import { getVacancy } from "@/modules/vacancies/queries";

export const metadata: Metadata = { title: "Editar vacante" };

export default async function EditVacancyPage({ params }: PageProps<"/vacantes/[id]/editar">) {
  const user = await requirePageUser();
  if (!can(user.role, "vacancies:manage")) return <AccessDenied />;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createSupabaseServerClient();
  const vacancy = await getVacancy(supabase, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });
  const owners = await listActiveProfiles(supabase);

  return (
    <>
      <PageHeader title="Editar vacante" eyebrow={vacancy.title} />
      <VacancyForm
        vacancyId={vacancy.id}
        owners={owners}
        defaultValues={{
          title: vacancy.title,
          department: vacancy.department,
          description: vacancy.description,
          responsibilities: vacancy.responsibilities,
          location: vacancy.location ?? "",
          modality: vacancy.modality ?? "",
          contractType: vacancy.contract_type ?? "",
          openingDate: vacancy.opening_date ?? "",
          closingDate: vacancy.closing_date ?? "",
          ownerId: vacancy.owner_id ?? "",
          city: vacancy.city ?? "",
          region: vacancy.region ?? "",
          employmentType: vacancy.employment_type ?? "",
          salaryMin: vacancy.salary_min === null ? "" : String(vacancy.salary_min),
          salaryMax: vacancy.salary_max === null ? "" : String(vacancy.salary_max),
          salaryCurrency: vacancy.salary_currency === "PEN" || vacancy.salary_currency === "USD" ? vacancy.salary_currency : "",
          salaryPeriod: vacancy.salary_period ?? "",
          isConfidential: vacancy.is_confidential,
        }}
      />
    </>
  );
}
