import Link from "next/link";
import { ApplicationStatusBadge, CompatibilityBadge } from "@/components/common/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { APPLICATION_STATUS_LABELS, CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import { DETAIL_LIMIT, type ReportDetail } from "@/modules/reports/detail";
import type { DetailRow } from "@/modules/reports/queries";

function detailTexts(detail: ReportDetail): { name: string; description: string } {
  switch (detail.kind) {
    case "etapa":
      return {
        name: APPLICATION_STATUS_LABELS[detail.value],
        description:
          "Postulaciones que hoy están en esta etapa (su estado actual), con los mismos filtros del reporte. " +
          "El embudo cuenta además las que ya pasaron de ella, por eso las cifras pueden diferir.",
      };
    case "fuente":
      return {
        name: CANDIDATE_SOURCE_LABELS[detail.value],
        description: "Postulaciones de candidatos de esta fuente, con los mismos filtros del reporte. Primero las más recientes.",
      };
    case "portal":
      return {
        name: detail.value,
        description: "Postulaciones que llegaron por este portal, con los mismos filtros del reporte. Primero las más recientes.",
      };
  }
}

/** Detalle de un clic del reporte: las postulaciones detrás de la cifra. Se abre y se cierra solo por la URL. */
export function DetailCard({ detail, rows, hasMore, closeHref }: { detail: ReportDetail; rows: DetailRow[]; hasMore: boolean; closeHref: string }) {
  const { name, description } = detailTexts(detail);
  return (
    <div id="detalle" className="scroll-mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Postulaciones en «{name}»</CardTitle>
          <CardDescription>{description}</CardDescription>
          <div className="pt-1">
            <Link
              href={closeHref}
              scroll={false}
              className="rounded-sm text-sm font-medium text-brand underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cerrar
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay postulaciones para mostrar con estos filtros.</p>
          ) : (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidato</TableHead>
                  <TableHead>Vacante</TableHead>
                  <TableHead>Postuló</TableHead>
                  <TableHead>Cumplimiento</TableHead>
                  <TableHead>Etapa actual</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-normal font-medium">
                      <Link
                        href={`/postulaciones/${row.id}`}
                        className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.candidateName ?? "Sin nombre"}
                      </Link>
                    </TableCell>
                    <TableCell data-label="Vacante" className="whitespace-normal">{row.vacancyTitle ?? "—"}</TableCell>
                    <TableCell data-label="Postuló">{formatDate(row.appliedAt)}</TableCell>
                    <TableCell data-label="Cumplimiento">
                      <CompatibilityBadge level={row.level} />
                    </TableCell>
                    <TableCell data-label="Etapa actual">{row.status ? <ApplicationStatusBadge status={row.status} /> : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {hasMore ? (
            <p className="text-xs text-muted-foreground">
              Se muestran las {DETAIL_LIMIT} más recientes; hay más postulaciones con este criterio. Afine los filtros para verlas.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
