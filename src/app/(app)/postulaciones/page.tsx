import type { Metadata } from "next";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PossibleDuplicate } from "@/components/applications/possible-duplicate";
import { CompatibilityBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatPercent } from "@/lib/format";
import { INTAKE_METHOD_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { INBOX_PAGE_SIZE, listInbox, listPortals } from "@/modules/intake/queries";
import { inboxParamsSchema } from "@/modules/intake/schemas";
import { listVacancies } from "@/modules/vacancies/queries";
import { Constants } from "@/types/database";

export const metadata: Metadata = { title: "Postulaciones nuevas" };

export default async function InboxPage({ searchParams }: PageProps<"/postulaciones">) {
  await requirePageUser();
  const params = inboxParamsSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const [{ rows, total, page }, portals, vacancies] = await Promise.all([
    listInbox(supabase, params),
    listPortals(supabase),
    listVacancies(supabase, {}),
  ]);

  const activeFilters = [params.vacancy, params.portal, params.method].filter(Boolean).length;

  const hrefForPage = (page: number) => {
    const search = new URLSearchParams({ page: String(page) });
    if (params.vacancy) search.set("vacancy", params.vacancy);
    if (params.portal) search.set("portal", params.portal);
    if (params.method) search.set("method", params.method);
    return `/postulaciones?${search.toString()}`;
  };

  const filtersForm = (className: string) => (
    <form method="get" className={className} aria-label="Filtros de postulaciones">
      <NativeSelect name="vacancy" defaultValue={params.vacancy} aria-label="Vacante" className="md:w-64">
        <NativeSelectOption value="">Todas las vacantes</NativeSelectOption>
        {vacancies.map((vacancy) => (
          <NativeSelectOption key={vacancy.id} value={vacancy.id}>
            {vacancy.title}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect name="portal" defaultValue={params.portal} aria-label="Portal" className="md:w-52">
        <NativeSelectOption value="">Todos los portales</NativeSelectOption>
        {portals.map((portal) => (
          <NativeSelectOption key={portal.id} value={portal.id}>
            {portal.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect name="method" defaultValue={params.method} aria-label="Método de ingreso" className="md:w-52">
        <NativeSelectOption value="">Todos los ingresos</NativeSelectOption>
        {Constants.public.Enums.application_intake_method.map((method) => (
          <NativeSelectOption key={method} value={method}>
            {INTAKE_METHOD_LABELS[method]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline">
        Aplicar
      </Button>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Postulaciones nuevas"
        description="Bandeja de entrada: las postulaciones en estado «Nuevo» de todas las vacantes, de la más reciente a la más antigua."
      />
      <details className="group rounded-md border bg-card shadow-xs md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>
            Filtros
            {activeFilters > 0 ? <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 text-xs text-background">{activeFilters}</span> : null}
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t p-3">{filtersForm("flex flex-col gap-2")}</div>
      </details>
      <div className="hidden md:block">{filtersForm("flex flex-wrap items-end gap-2")}</div>

      {rows.length === 0 ? (
        <EmptyState
          title="No hay postulaciones nuevas"
          description="Las postulaciones cargadas en lote o registradas en una vacante aparecen aquí mientras estén en estado «Nuevo»."
        />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table stacked>
            <TableHeader>
              <TableRow>
                <TableHead>Candidato</TableHead>
                <TableHead>Vacante</TableHead>
                <TableHead>Portal</TableHead>
                <TableHead className="sm:max-md:hidden">Ingreso</TableHead>
                <TableHead>Cumplimiento</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="align-top max-sm:grid! max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-start max-sm:gap-y-1 max-sm:pr-8">
                  <TableCell className="whitespace-normal max-sm:col-start-1 max-sm:row-start-1">
                    <Link
                      href={`/postulaciones/${row.id}`}
                      className="font-medium hover:underline max-sm:after:absolute max-sm:after:inset-0 max-sm:after:content-['']"
                    >
                      {row.candidate_name}
                    </Link>
                    <div className="text-xs text-muted-foreground max-sm:hidden">{row.candidate_email}</div>
                    <PossibleDuplicate reasons={row.possible_duplicate_reasons} />
                    <ChevronRight className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground sm:hidden" aria-hidden />
                  </TableCell>
                  <TableCell className="whitespace-normal max-sm:col-span-2 max-sm:row-start-2">
                    <Link href={`/vacantes/${row.vacancy_id}`} className="hover:underline max-sm:pointer-events-none">
                      {row.vacancy_title}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{row.portal_name ?? "—"}</TableCell>
                  <TableCell className="hidden sm:max-md:hidden md:table-cell">{row.intake_method ? INTAKE_METHOD_LABELS[row.intake_method] : "—"}</TableCell>
                  <TableCell className="whitespace-normal max-sm:col-start-2 max-sm:row-start-1">
                    <CompatibilityBadge level={row.level} className="max-sm:h-auto max-sm:max-w-32 max-sm:rounded-xl max-sm:text-center max-sm:text-[11px] max-sm:leading-tight max-sm:whitespace-normal" />
                    {row.evaluation_id ? (
                      <div className="mt-1 hidden text-xs text-muted-foreground sm:block">{formatPercent(row.score)} acreditado</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{formatDateTime(row.applied_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-sm:col-span-2 max-sm:row-start-3 sm:hidden">
                    {[row.portal_name, formatDate(row.applied_at), row.evaluation_id ? formatPercent(row.score) : null].filter(Boolean).join(" · ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={INBOX_PAGE_SIZE} total={total} hrefForPage={hrefForPage} />
    </>
  );
}
