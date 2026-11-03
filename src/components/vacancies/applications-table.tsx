import Link from "next/link";
import { PossibleDuplicate } from "@/components/applications/possible-duplicate";
import { ApplicationStatusBadge, CompatibilityBadge } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { Pagination } from "@/components/common/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CompareBar, COMPARE_CHECKBOX_NAME } from "./compare-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatPercent } from "@/lib/format";
import { APPLICATION_STATUS_LABELS, COMPATIBILITY_LEVEL_LABELS, INTAKE_METHOD_LABELS } from "@/lib/labels";
import { APPLICATIONS_PAGE_SIZE } from "@/modules/applications/queries";
import { isDiscardedStatus, statusesOfView, type ApplicationListParams } from "@/modules/applications/schemas";
import { cn } from "@/lib/utils";
import { Constants, type Views } from "@/types/database";

/** Con evaluación y no descartada: puede entrar a la comparación. */
const isComparable = (row: Views<"application_overview">) =>
  Boolean(row.evaluation_id) && row.status !== null && !isDiscardedStatus(row.status);

function ShortList({ items, empty }: { items: string[] | null; empty: string }) {
  if (!items?.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {items.map((item) => (
        <li key={item} className="line-clamp-2">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Lista completa de candidatos de la vacante. No oculta ninguna postulación
 * por su puntuación: el orden por puntuación es solo una opción de vista.
 */
export function ApplicationsTable({
  vacancyId,
  rows,
  total,
  params,
  viewCounts,
}: {
  vacancyId: string;
  rows: Views<"application_overview">[];
  total: number;
  params: ApplicationListParams;
  viewCounts: { inProcess: number; discarded: number };
}) {
  const anyComparable = rows.some(isComparable);
  const hrefForPage = (page: number) => {
    const search = new URLSearchParams({ tab: "candidatos", vista: params.vista, sort: params.sort, page: String(page) });
    if (params.q) search.set("q", params.q);
    if (params.status) search.set("status", params.status);
    if (params.level) search.set("level", params.level);
    return `/vacantes/${vacancyId}?${search.toString()}`;
  };

  const hrefForView = (vista: ApplicationListParams["vista"]) => {
    const search = new URLSearchParams({ tab: "candidatos", vista, sort: params.sort });
    if (params.q) search.set("q", params.q);
    if (params.level) search.set("level", params.level);
    return `/vacantes/${vacancyId}?${search.toString()}`;
  };
  const views = [
    { id: "proceso", label: `En proceso (${viewCounts.inProcess})` },
    { id: "descartados", label: `Descartados (${viewCounts.discarded})` },
  ] as const;

  return (
    <div className="space-y-4">
      <nav className="flex gap-1" aria-label="Vista de candidatos">
        {views.map((view) => (
          <Link
            key={view.id}
            href={hrefForView(view.id)}
            aria-current={params.vista === view.id ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm whitespace-nowrap",
              params.vista === view.id ? "border-brand bg-brand/10 font-medium text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {view.label}
          </Link>
        ))}
      </nav>
      {params.vista === "descartados" ? (
        <p className="text-sm text-muted-foreground">
          No seleccionados y retirados. No se borra nada: para reactivar a alguien, abra su postulación y cambie su estado.
        </p>
      ) : null}
      <form method="get" className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-end" aria-label="Filtros de candidatos">
        <input type="hidden" name="tab" value="candidatos" />
        <input type="hidden" name="vista" value={params.vista} />
        <Input name="q" defaultValue={params.q} placeholder="Buscar por nombre o correo" className="md:w-64" aria-label="Buscar" />
        <NativeSelect name="status" defaultValue={params.status} aria-label="Estado del proceso" className="md:w-52">
          <NativeSelectOption value="">{params.vista === "descartados" ? "No seleccionados y retirados" : "Todos los estados en proceso"}</NativeSelectOption>
          {statusesOfView(params.vista).map((status) => (
            <NativeSelectOption key={status} value={status}>
              {APPLICATION_STATUS_LABELS[status]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="level" defaultValue={params.level} aria-label="Compatibilidad" className="md:w-52">
          <NativeSelectOption value="">Toda compatibilidad</NativeSelectOption>
          {Constants.public.Enums.compatibility_level.map((level) => (
            <NativeSelectOption key={level} value={level}>
              {COMPATIBILITY_LEVEL_LABELS[level]}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="sin_evaluar">Sin evaluar</NativeSelectOption>
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={params.sort} aria-label="Ordenar por" className="md:w-48">
          <NativeSelectOption value="puntuacion">Ordenar por puntuación</NativeSelectOption>
          <NativeSelectOption value="fecha">Más recientes</NativeSelectOption>
          <NativeSelectOption value="nombre">Nombre (A-Z)</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" variant="outline">
          Aplicar
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title={params.vista === "descartados" ? "No hay candidatos descartados" : "No hay candidatos que coincidan"}
          description={
            params.vista === "descartados"
              ? "Aquí aparecen quienes pasan a «No seleccionado» o «Retirado»."
              : "Registre candidatos desde la sección Candidatos y asócielos a esta vacante."
          }
        />
      ) : (
        <>
        {/* La key vuelve a sincronizar la selección al cambiar de vista, página, filtros o filas. */}
        {anyComparable ? (
          <CompareBar
            key={`${params.vista}|${params.page}|${params.q}|${params.status}|${params.level}|${params.sort}|${rows.map((row) => row.id).join(",")}`}
            vacancyId={vacancyId}
          />
        ) : null}
        <div className="overflow-hidden rounded-md border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <span className="sr-only">Comparar</span>
                </TableHead>
                <TableHead>Candidato</TableHead>
                <TableHead>Compatibilidad orientativa</TableHead>
                <TableHead className="hidden lg:table-cell">Requisitos acreditados</TableHead>
                <TableHead className="hidden lg:table-cell">Brechas / sin evidencia</TableHead>
                <TableHead className="hidden xl:table-cell">Pendiente de verificar</TableHead>
                <TableHead>Estado del proceso</TableHead>
                <TableHead className="hidden md:table-cell">Postulación</TableHead>
                <TableHead className="hidden md:table-cell">Portal e ingreso</TableHead>
                <TableHead className="hidden md:table-cell">Opinión solicitada</TableHead>
                <TableHead className="hidden xl:table-cell">Notificación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="align-top">
                  <TableCell>
                    {row.id && isComparable(row) ? (
                      <input
                        type="checkbox"
                        name={COMPARE_CHECKBOX_NAME}
                        value={row.id}
                        aria-label={`Comparar a ${row.candidate_name}`}
                        className="size-4 accent-primary"
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link href={`/postulaciones/${row.id}`} className="font-medium hover:underline">
                      {row.candidate_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{row.vacancy_title}</div>
                    <PossibleDuplicate reasons={row.possible_duplicate_reasons} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <CompatibilityBadge level={row.level} />
                    {row.evaluation_id ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatPercent(row.score)} acreditado · hasta {formatPercent(row.score_potential)}
                        {row.evaluation_outdated ? <div>Criterios actualizados: reevaluar</div> : null}
                        {row.review_status === "pendiente_revision" ? <div>Pendiente de revisión de RRHH</div> : null}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden max-w-56 text-xs whitespace-normal lg:table-cell">
                    <ShortList items={row.top_met} empty="—" />
                  </TableCell>
                  <TableCell className="hidden max-w-56 text-xs whitespace-normal lg:table-cell">
                    <ShortList items={row.top_gaps} empty="—" />
                  </TableCell>
                  <TableCell className="hidden max-w-56 text-xs whitespace-normal xl:table-cell">
                    <ShortList items={row.top_pending} empty="—" />
                  </TableCell>
                  <TableCell>{row.status ? <ApplicationStatusBadge status={row.status} /> : null}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(row.applied_at)}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {row.portal_name ?? "—"}
                    {row.intake_method ? (
                      <span className="block text-xs text-muted-foreground">{INTAKE_METHOD_LABELS[row.intake_method]}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {row.assigned_evaluator_name ?? "—"}
                    {row.assigned_evaluator_name && row.opinion_requested_at && !row.opinion_answered_at ? (
                      <span className="block text-xs text-warning-foreground">Pendiente</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">No disponible (Etapa 3)</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
      <Pagination page={params.page} pageSize={APPLICATIONS_PAGE_SIZE} total={total} hrefForPage={hrefForPage} />
    </div>
  );
}
