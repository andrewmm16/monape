import type { Metadata } from "next";
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
import { formatDateTime, formatPercent } from "@/lib/format";
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

  const hrefForPage = (page: number) => {
    const search = new URLSearchParams({ page: String(page) });
    if (params.vacancy) search.set("vacancy", params.vacancy);
    if (params.portal) search.set("portal", params.portal);
    if (params.method) search.set("method", params.method);
    return `/postulaciones?${search.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Postulaciones nuevas"
        description="Bandeja de entrada: las postulaciones en estado «Nuevo» de todas las vacantes, de la más reciente a la más antigua."
      />
      <form method="get" className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end" aria-label="Filtros de postulaciones">
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

      {rows.length === 0 ? (
        <EmptyState
          title="No hay postulaciones nuevas"
          description="Las postulaciones cargadas en lote o registradas en una vacante aparecen aquí mientras estén en estado «Nuevo»."
        />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidato</TableHead>
                <TableHead>Vacante</TableHead>
                <TableHead>Portal</TableHead>
                <TableHead className="hidden md:table-cell">Ingreso</TableHead>
                <TableHead>Compatibilidad orientativa</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="whitespace-normal">
                    <Link href={`/postulaciones/${row.id}`} className="font-medium hover:underline">
                      {row.candidate_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{row.candidate_email}</div>
                    <PossibleDuplicate reasons={row.possible_duplicate_reasons} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link href={`/vacantes/${row.vacancy_id}`} className="hover:underline">
                      {row.vacancy_title}
                    </Link>
                  </TableCell>
                  <TableCell>{row.portal_name ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{row.intake_method ? INTAKE_METHOD_LABELS[row.intake_method] : "—"}</TableCell>
                  <TableCell className="whitespace-normal">
                    <CompatibilityBadge level={row.level} />
                    {row.evaluation_id ? (
                      <div className="mt-1 text-xs text-muted-foreground">{formatPercent(row.score)} acreditado</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{formatDateTime(row.applied_at)}</TableCell>
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
