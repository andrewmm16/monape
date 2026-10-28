import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { VacancyForm } from "@/components/vacancies/vacancy-form";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listActiveProfiles } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Nueva vacante" };

export default async function NewVacancyPage() {
  const user = await requirePageUser();
  if (!can(user.role, "vacancies:manage")) return <AccessDenied />;
  const supabase = await createSupabaseServerClient();
  const owners = await listActiveProfiles(supabase);

  return (
    <>
      <PageHeader title="Nueva vacante" description="La vacante se crea en borrador. Después defina y apruebe sus requisitos." />
      <VacancyForm
        owners={owners}
        defaultValues={{
          title: "",
          department: "",
          description: "",
          responsibilities: "",
          location: "",
          modality: "",
          contractType: "",
          openingDate: "",
          closingDate: "",
          ownerId: user.id,
          city: "",
          region: "",
          employmentType: "",
          salaryMin: "",
          salaryMax: "",
          salaryCurrency: "",
          salaryPeriod: "",
          isConfidential: false,
        }}
      />
    </>
  );
}
