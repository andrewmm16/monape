import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon, UploadIcon } from "lucide-react";
import { z } from "zod";
import { VacancyStatusBadge } from "@/components/common/badges";
import { PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VacancySuggestions } from "@/components/talent/vacancy-suggestions";
import { PublicLink } from "@/components/vacancies/public-listing-notice";
import { ApplicationsBoard } from "@/components/vacancies/applications-board";
import { ApplicationsTable } from "@/components/vacancies/applications-table";
import { EvaluatePendingButton } from "@/components/vacancies/evaluate-pending-button";
import { PortalsPanel } from "@/components/vacancies/portals-panel";
import { PublishPortalsSection } from "@/components/vacancies/publish-portals-section";
import { KillerQuestionsPanel } from "@/components/vacancies/killer-questions-panel";
import { RequirementsPanel } from "@/components/vacancies/requirements-panel";
import { VacancyStatusActions } from "@/components/vacancies/vacancy-status-actions";
import { VacancySteps } from "@/components/vacancies/vacancy-steps";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABELS, WORK_MODALITY_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { countComparable } from "@/modules/applications/compare";
import {
  countApplicationViews,
  countKillerFlags,
  countPendingEvaluations,
  countVacancyApplications,
  listApplicationsForBoard,
  listVacancyApplications,
  rankVacancyApplications,
} from "@/modules/applications/queries";
import { applicationListParamsSchema } from "@/modules/applications/schemas";
import { getEmailReplyTo } from "@/modules/email-templates/queries";
import { suggestCandidatesForVacancy } from "@/modules/talent-pool/matching";
import { portalLogo } from "@/modules/portals/logos";
import { listPortalPublications } from "@/modules/portals/queries";
import { getVacancy, listKillerQuestions, listRequirements } from "@/modules/vacancies/queries";
import { publishBlockers } from "@/modules/vacancies/schemas";
import { getPublicJobsConfig } from "@/modules/public-jobs/config";
import { isClosingDatePassed, publicationGaps } from "@/modules/public-jobs/gaps";
import { formatSalaryText } from "@/modules/public-jobs/feed";
import { jobPath } from "@/modules/public-jobs/slug";

export const metadata: Metadata = { title: "Vacante" };

const TABS = [
  { id: "candidatos", label: "Candidatos" },
  { id: "criterios", label: "Requisitos y criterios" },
  { id: "detalle", label: "Detalle" },
  { id: "portales", label: "Portales" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Base pública para el enlace que RRHH ve y copia en la ficha. Se arma con el
 * host real de la petición (el mismo navegador y puerto donde está abierta la
 * app), así el enlace sigue al servidor sin tocar configuración al cambiar de
 * puerto (3000, 3100, etc.). Si no hubiera cabecera de host, cae al siteUrl
 * configurado. Las URLs canónicas/SEO/sitemap/feed siguen usando config.siteUrl.
 */
async function requestPublicBase(fallback: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return fallback;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Estado de la vacante publicada en la página pública, Google y el feed. */
async function PublicListingStatus({ vacancy }: { vacancy: Awaited<ReturnType<typeof getVacancy>> }) {
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
  const base = await requestPublicBase(config.siteUrl);
  return (
    <Alert>
      <AlertTitle>Página pública</AlertTitle>
      <AlertDescription>
        <PublicLink url={`${base}${jobPath(vacancy.title, vacancy.public_code)}`} />
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
  const canDeleteVacancy = can(user.role, "vacancies:delete");
  // En paralelo y solo lo que usa la pestaña abierta:
  // - el conteo de postulaciones, solo para confirmar el borrado en cascada (archivadas);
  // - los requisitos, para los pasos de un borrador y lo que falta para publicar («Portales»);
  // - los portales del robot, solo en «Portales».
  const [archivedApplicationCount, requirementCount, botPortals] = await Promise.all([
    vacancy.status === "archivada" && canDeleteVacancy ? countVacancyApplications(supabase, vacancy.id) : 0,
    tab === "portales" || vacancy.status === "borrador"
      ? supabase
          .from("vacancy_requirements")
          .select("id", { count: "exact", head: true })
          .eq("vacancy_id", vacancy.id)
          .then(({ count, error }) => {
            if (error) throw error;
            return count ?? 0;
          })
      : 0,
    tab === "portales" && canManage && (vacancy.status === "borrador" || vacancy.status === "cerrada")
      ? listPortalPublications(supabase, vacancy.id).then((rows) =>
          rows
            .filter((row) => row.portal.bot_enabled)
            .map((row) => ({ id: row.portal.id, name: row.portal.name, logo: portalLogo(row.portal.name) })),
        )
      : [],
  ]);
  const criteriaApproved = Boolean(vacancy.criteria_approved_at);
  const blockers = publishBlockers({ requirementCount, criteriaApproved });

  let content: React.ReactNode;
  if (tab === "candidatos") {
    const modo: "tabla" | "tablero" = search.modo === "tablero" ? "tablero" : "tabla";
    const canRun = can(user.role, "evaluations:run");
    const pending = canRun ? await countPendingEvaluations(supabase, vacancy.id) : 0;
    const comparable = await countComparable(supabase, vacancy.id);
    // Sugerencias de la base de talento: solo si RRHH puede gestionar candidatos y la vacante admite postulaciones.
    const showSuggestions =
      can(user.role, "candidates:manage") && (vacancy.status === "borrador" || vacancy.status === "publicada");
    const [suggestedCandidates, replyTo] = showSuggestions
      ? await Promise.all([
          suggestCandidatesForVacancy(supabase, vacancy.id),
          // Un fallo al leerlo solo deja el botón de invitar bloqueado, no rompe la página.
          getEmailReplyTo(supabase).catch(() => null),
        ])
      : [null, null];
    const suggestions =
      suggestedCandidates === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Candidatos de tu base que encajan</CardTitle>
            <CardDescription>
              Perfiles de tu histórico que coinciden con los requisitos y están disponibles para reactivar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VacancySuggestions vacancyId={vacancy.id} candidates={suggestedCandidates} replyToConfigured={Boolean(replyTo)} />
          </CardContent>
        </Card>
      );
    const toggleLink = (target: "tabla" | "tablero", label: string) => (
      <Link
        href={target === "tablero" ? `/vacantes/${vacancy.id}?tab=candidatos&modo=tablero` : `/vacantes/${vacancy.id}?tab=candidatos`}
        aria-current={modo === target ? "page" : undefined}
        className={cn(
          "rounded-md border px-3 py-1.5 text-sm whitespace-nowrap",
          modo === target ? "border-brand bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
      </Link>
    );
    const actions = (
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-start gap-2">
          {canRun ? (
            <EvaluatePendingButton vacancyId={vacancy.id} pending={pending} criteriaApproved={Boolean(vacancy.criteria_approved_at)} />
          ) : null}
          {comparable >= 2 ? (
            <Link href={`/vacantes/${vacancy.id}/comparar?mejores=1`} className={buttonVariants({ variant: "outline" })}>
              Comparar los mejores
            </Link>
          ) : null}
        </div>
        <nav className="flex gap-1" aria-label="Modo de vista de candidatos">
          {toggleLink("tabla", "Tabla")}
          {toggleLink("tablero", "Tablero")}
        </nav>
      </div>
    );
    if (modo === "tablero") {
      const boardRows = await listApplicationsForBoard(supabase, vacancy.id);
      content = (
        <div className="space-y-4">
          {suggestions}
          {actions}
          <ApplicationsBoard rows={boardRows} canManage={canManage} />
        </div>
      );
    } else {
      const listParams = applicationListParamsSchema.parse(search);
      const [{ rows, total }, viewCounts, ranking] = await Promise.all([
        listVacancyApplications(supabase, vacancy.id, listParams),
        countApplicationViews(supabase, vacancy.id),
        // La posición se calcula sobre toda la vacante, no sobre la página: el
        // 3.º de 40 tiene que seguir siendo el 3.º al cambiar de página o filtro.
        rankVacancyApplications(supabase, vacancy.id),
      ]);
      const killerFlags = await countKillerFlags(
        supabase,
        rows.flatMap((r) => (r.id ? [r.id] : [])),
      );
      content = (
        <div className="space-y-4">
          {suggestions}
          {actions}
          <ApplicationsTable
            vacancyId={vacancy.id}
            rows={rows}
            total={total}
            params={listParams}
            viewCounts={viewCounts}
            ranking={ranking}
            killerFlags={killerFlags}
          />
        </div>
      );
    }
  } else if (tab === "criterios") {
    const [requirements, killerQuestions] = await Promise.all([
      listRequirements(supabase, vacancy.id),
      canManage ? listKillerQuestions(supabase, vacancy.id) : Promise.resolve([]),
    ]);
    content = (
      <div className="space-y-6">
        <RequirementsPanel vacancy={vacancy} requirements={requirements} canManage={canManage} />
        <KillerQuestionsPanel vacancyId={vacancy.id} questions={killerQuestions} canManage={canManage} />
      </div>
    );
  } else if (tab === "portales") {
    content =
      canManage && (vacancy.status === "borrador" || vacancy.status === "cerrada") ? (
        <PublishPortalsSection
          vacancyId={vacancy.id}
          portals={botPortals}
          blockers={blockers}
          reopen={vacancy.status === "cerrada"}
          confidential={vacancy.is_confidential}
        />
      ) : (
        <PortalsPanel
          vacancyId={vacancy.id}
          vacancyStatus={vacancy.status}
          rows={await listPortalPublications(supabase, vacancy.id)}
          botEnabled={Boolean(getServerEnv().PORTAL_BOT_SECRET)}
        />
      );
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
              <VacancyStatusActions
                vacancyId={vacancy.id}
                status={vacancy.status}
                canDelete={canDeleteVacancy}
                applicationCount={archivedApplicationCount}
              />
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
                ? "border-brand font-medium text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {vacancy.status === "borrador" ? (
        <VacancySteps
          steps={[
            { label: "Datos de la vacante", done: true },
            { label: "Requisitos", done: (requirementCount ?? 0) > 0 },
            { label: "Aprobar criterios", done: criteriaApproved },
            { label: "Publicar y elegir portales", done: false },
          ]}
        />
      ) : null}
      <PublicListingStatus vacancy={vacancy} />
      {content}
    </>
  );
}
