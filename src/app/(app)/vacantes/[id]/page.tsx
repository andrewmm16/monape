import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon, UploadIcon } from "lucide-react";
import { z } from "zod";
import { VacancyStatusBadge } from "@/components/common/badges";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicLink } from "@/components/vacancies/public-listing-notice";
import { ApplicationsTable } from "@/components/vacancies/applications-table";
import { EvaluatePendingButton } from "@/components/vacancies/evaluate-pending-button";
import { RequirementsPanel } from "@/components/vacancies/requirements-panel";
import { VacancyStatusActions } from "@/components/vacancies/vacancy-status-actions";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABELS, WORK_MODALITY_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { countPendingEvaluations, listVacancyApplications } from "@/modules/applications/queries";
import { applicationListParamsSchema } from "@/modules/applications/schemas";
import { getVacancy, listRequirements } from "@/modules/vacancies/queries";
import { getPublicJobsConfig } from "@/modules/public-jobs/config";
import { isClosingDatePassed, publicationGaps } from "@/modules/public-jobs/gaps";
import { formatSalaryText } from "@/modules/public-jobs/feed";
import { jobPath } from "@/modules/public-jobs/slug";

export const metadata: Metadata = { title: "Vacante" };

const TABS = [
  { id: "candidatos", label: "Candidatos" },
  { id: "criterios", label: "Requisitos y criterios" },
  { id: "detalle", label: "Detalle" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Estado de la vacante publicada en la página pública, Google y el feed. */
function PublicListingStatus({ vacancy }: { vacancy: Awaited<ReturnType<typeof getVacancy>> }) {
  if (vacancy.status !== "publicada") return null;
  if (vacancy.is_confidential) {
    return (
      <Alert>
        <AlertTitle>Vacante confidencial</AlertTitle>
        <AlertDescription>No aparece en la página pública, en Google ni en los buscadores de empleo.</AlertDescription>
      </Alert>
    );
  }
  const gaps = publicationGaps(vacancy);
  if (gaps.length > 0) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No sale en Google ni en el feed de empleo</AlertTitle>
        <AlertDescription>Falta {gaps.join(", ")}. Edite la vacante para completar los datos.</AlertDescription>
      </Alert>
    );
  }
  if (isClosingDatePassed(vacancy.closing_date)) {
    return (
      <Alert>
        <AlertTitle>Fecha de cierre vencida</AlertTitle>
        <AlertDescription>Ya no aparece en la página pública, en Google ni en el feed de empleo.</AlertDescription>
      </Alert>
    );
  }
  const config = getPublicJobsConfig();
  if (!config.enabled || !vacancy.public_code) {
    return (
      <Alert>
        <AlertTitle>Página pública apagada</AlertTitle>
        <AlertDescription>Este servidor no tiene encendida la parte pública (PUBLIC_JOBS_ENABLED).</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <AlertTitle>Página pública</AlertTitle>
      <AlertDescription>
        <PublicLink url={`${config.siteUrl}${jobPath(vacancy.title, vacancy.public_code)}`} />
      </AlertDescription>
    </Alert>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}

export default async function VacancyPage({ params, searchParams }: PageProps<"/vacantes/[id]">) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const search = await searchParams;
  const tab: TabId = TABS.some((t) => t.id === search.tab) ? (search.tab as TabId) : "candidatos";

  const supabase = await createSupabaseServerClient();
  const vacancy = await getVacancy(supabase, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });
  const canManage = can(user.role, "vacancies:manage");

  let content: React.ReactNode;
  if (tab === "candidatos") {
    const listParams = applicationListParamsSchema.parse(search);
    const { rows, total } = await listVacancyApplications(supabase, vacancy.id, listParams);
    const pending = can(user.role, "evaluations:run") ? await countPendingEvaluations(supabase, vacancy.id) : 0;
    content = (
      <div className="space-y-4">
        {can(user.role, "evaluations:run") ? (
          <EvaluatePendingButton vacancyId={vacancy.id} pending={pending} criteriaApproved={Boolean(vacancy.criteria_approved_at)} />
        ) : null}
        <ApplicationsTable vacancyId={vacancy.id} rows={rows} total={total} params={listParams} />
      </div>
    );
  } else if (tab === "criterios") {
    const requirements = await listRequirements(supabase, vacancy.id);
    content = <RequirementsPanel vacancy={vacancy} requirements={requirements} canManage={canManage} />;
  } else {
    content = (
      <Card>
        <CardHeader>
          <CardTitle>Información de la vacante</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Área" value={vacancy.department} />
            <Detail label="Ubicación" value={vacancy.location} />
            <Detail label="Modalidad" value={vacancy.modality ? WORK_MODALITY_LABELS[vacancy.modality] : null} />
            <Detail label="Tipo de contrato" value={vacancy.contract_type} />
            <Detail label="Apertura" value={formatDate(vacancy.opening_date)} />
            <Detail label="Cierre" value={formatDate(vacancy.closing_date)} />
            <Detail label="Responsable del proceso" value={vacancy.owner?.full_name} />
            <Detail label="Ciudad" value={vacancy.city} />
            <Detail label="Región" value={vacancy.region} />
            <Detail label="Tipo de empleo" value={vacancy.employment_type ? EMPLOYMENT_TYPE_LABELS[vacancy.employment_type] : null} />
            <Detail
              label="Sueldo"
              value={
                vacancy.salary_min !== null && (vacancy.salary_currency === "PEN" || vacancy.salary_currency === "USD") && vacancy.salary_period
                  ? formatSalaryText({
                      min: vacancy.salary_min,
                      max: vacancy.salary_max,
                      currency: vacancy.salary_currency,
                      period: vacancy.salary_period,
                    })
                  : null
              }
            />
            <Detail label="Publicación" value={vacancy.is_confidential ? "Confidencial" : "Pública al publicar"} />
          </dl>
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Descripción</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{vacancy.description || "—"}</p>
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Responsabilidades</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{vacancy.responsibilities || "—"}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/vacantes" className="hover:underline">
            Vacantes
          </Link>
        }
        title={vacancy.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <VacancyStatusBadge status={vacancy.status} />
            <span>{vacancy.department}</span>
          </span>
        }
        actions={
          canManage ? (
            <>
              {can(user.role, "candidates:manage") && (vacancy.status === "borrador" || vacancy.status === "publicada") ? (
                <Button asChild variant="outline">
                  <Link href={`/vacantes/${vacancy.id}/carga-masiva`}>
                    <UploadIcon /> Carga masiva de CV
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href={`/vacantes/${vacancy.id}/editar`}>
                  <PencilIcon /> Editar
                </Link>
              </Button>
              <VacancyStatusActions vacancyId={vacancy.id} status={vacancy.status} canDelete={can(user.role, "vacancies:delete")} />
            </>
          ) : null
        }
      />
      <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Secciones de la vacante">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/vacantes/${vacancy.id}?tab=${item.id}`}
            aria-current={tab === item.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              tab === item.id
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <PublicListingStatus vacancy={vacancy} />
      {content}
    </>
  );
}
