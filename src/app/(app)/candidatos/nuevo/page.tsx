import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { CandidateForm } from "@/components/candidates/candidate-form";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOpenVacancies } from "@/modules/vacancies/queries";

export const metadata: Metadata = { title: "Registrar candidato" };

export default async function NewCandidatePage({ searchParams }: PageProps<"/candidatos/nuevo">) {
  const user = await requirePageUser();
  if (!can(user.role, "candidates:manage")) return <AccessDenied />;
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const vacancies = await listOpenVacancies(supabase);
  const preselected = typeof params.vacante === "string" && vacancies.some((v) => v.id === params.vacante) ? params.vacante : "";

  return (
    <>
      <PageHeader
        title="Registrar candidato"
        description="Después de registrarlo podrá cargar su CV. Se verifica si existen posibles duplicados."
      />
      <CandidateForm
        vacancies={vacancies}
        defaultValues={{
          fullName: "",
          email: "",
          phone: "",
          location: "",
          linkedinUrl: "",
          source: "manual",
          sourceDetail: "",
          vacancyId: preselected,
          confirmDuplicate: false,
        }}
      />
    </>
  );
}
