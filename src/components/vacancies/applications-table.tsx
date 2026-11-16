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
import { APPLICATION_STATUS_LABELS, COMPATIBILITY_LEVEL_LABELS } from "@/lib/labels";
import { APPLICATIONS_PAGE_SIZE, type ApplicationRanking } from "@/modules/applications/queries";
import { isDiscardedStatus, statusesOfView, type ApplicationListParams } from "@/modules/applications/schemas";
import { cn } from "@/lib/utils";
import { Constants, type Views } from "@/types/database";

/** Con evaluación y no descartada: puede entrar a la comparación. */
const isComparable = (row: Views<"application_overview">) =>
  Boolean(row.evaluation_id) && row.status !== null && !isDiscardedStatus(row.status);

/** Una línea con los primeros requisitos (por ejemplo «Cumple: Excel, SAP +2 más»). */
function ReasonLine({ label, items, empty }: { label: string; items: string[] | null; empty: string }) {
  if (!items?.length) return empty ? <p className="text-muted-foreground">{empty}</p> : null;
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return (
    <p className="line-clamp-3">
      <span className="font-medium">{label}:</span> {shown.join(", ")}
      {more > 0 ? ` y ${more} más` : ""}
    </p>
  );
}

/**
 * Posición dentro de la vacante. Es la lectura comparativa, separada a
 * propósito del nivel de cumplimiento que está al lado: una dice si la persona
 * cumple el puesto y la otra cuánto destaca frente a los demás. No se muestra
 * en la vista de descartados, donde la posición no significa nada.
 */
function RankLine({ position, evaluated }: { position: number | undefined; evaluated: number }) {
  if (position === undefined || evaluated < 2) return null;
  return (
    <div className="text-xs text-muted-foreground tabular-nums">
      {position}.º por puntuación de {evaluated} en proceso
    </div>
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
  ranking,
  killerFlags,
}: {
  vacancyId: string;
  rows: Views<"application_overview">[];
  total: number;
  params: ApplicationListParams;
  viewCounts: { inProcess: number; discarded: number };
  ranking: ApplicationRanking;
  /** Postulaciones con respuestas eliminatorias que no cumplen (solo informativo). */
  killerFlags?: Map<string, number>;
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
        <NativeSelect name="level" defaultValue={params.level} aria-label="Nivel de cumplimiento" className="md:w-52">
          <NativeSelectOption value="">Todo nivel de cumplimiento</NativeSelectOption>
          {Constants.public.Enums.compatibility_level.map((level) => (
            <NativeSelectOption key={level} value={level}>
              {COMPATIBILITY_LEVEL_LABELS[level]}
            </NativeSelectOption>
          ))}
          <NativeSelectOption value="sin_evaluar">Sin evaluar</NativeSelectOption>
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={params.sort} aria-label="Ordenar por" className="md:w-48">
          <NativeSelectOption value="puntuacion">Mayor puntuación primero</NativeSelectOption>
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
                <TableHead>Cumplimiento y posición</TableHead>
                <TableHead className="hidden md:table-cell">Por qué</TableHead>
                <TableHead>Estado</TableHead>
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
                    <div className="text-xs text-muted-foreground">
                      Postuló el {formatDate(row.applied_at)}
                      {row.portal_name ? ` · ${row.portal_name}` : ""}
                    </div>
                    <PossibleDuplicate reasons={row.possible_duplicate_reasons} />
                    {row.id && killerFlags?.get(row.id) ? (
                      <div className="mt-0.5 text-xs text-warning-foreground">
                        {killerFlags.get(row.id) === 1 ? "No cumple la condición indicada" : `No cumple ${killerFlags.get(row.id)} condiciones indicadas`}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {row.evaluation_id ? (
                      <>
                        <div className="text-lg font-semibold tabular-nums">{formatPercent(row.score)}</div>
                        <CompatibilityBadge level={row.level} />
                        {params.vista === "proceso" && row.id ? (
                          <RankLine position={ranking.positions.get(row.id)} evaluated={ranking.evaluated} />
                        ) : null}
                        {row.evaluation_outdated ? <div className="mt-1 text-xs text-warning-foreground">Criterios cambiados: vuelva a evaluar</div> : null}
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">Sin evaluar</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-72 space-y-1 text-xs whitespace-normal md:table-cell">
                    {row.evaluation_id ? (
                      <>
                        <ReasonLine label="Cumple" items={row.top_met} empty="Ningún requisito aparece en el CV" />
                        <ReasonLine label="Falta" items={row.top_gaps} empty="" />
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{row.status ? <ApplicationStatusBadge status={row.status} /> : null}</TableCell>
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
