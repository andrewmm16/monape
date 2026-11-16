import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { BarRow } from "@/components/reports/bar-row";
import { FunnelChart } from "@/components/reports/funnel-chart";
import { SourcesChart } from "@/components/reports/sources-chart";
import { StatTiles, type StatTile } from "@/components/reports/stat-tiles";
import { TrendChart } from "@/components/reports/trend-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatPercent } from "@/lib/format";
import { APPLICATION_STATUS_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatHours } from "@/modules/reports/metrics";
import { getReport, listReportVacancies, reportParamsSchema } from "@/modules/reports/queries";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportsPage({ searchParams }: PageProps<"/reportes">) {
  const user = await requirePageUser();
  // Reportes y exportación son solo para el personal de RRHH.
  if (!can(user.role, "applications:manage")) redirect("/panel");

  const params = reportParamsSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const [vacancies, report] = await Promise.all([listReportVacancies(supabase), getReport(supabase, params)]);

  const selected = vacancies.find((v) => v.id === params.vacante);
  const maxSide = Math.max(1, ...report.side.map((s) => s.current));

  const tiles: StatTile[] = [
    { label: "Postulaciones", value: String(report.kpis.total) },
    { label: "En proceso", value: String(report.kpis.inProcess) },
    { label: "Seleccionados", value: String(report.kpis.selected) },
    { label: "Descartados", value: String(report.kpis.discarded) },
    {
      label: "Conversión",
      value: report.kpis.conversion === null ? "—" : formatPercent(report.kpis.conversion * 100),
      hint: "seleccionados / total",
    },
    {
      label: "Tiempo a decisión",
      value: report.times.toDecision ? formatHours(report.times.toDecision.medianHours) : "—",
      hint: "mediana",
    },
  ];

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Resumen, embudo, fuentes, tendencia y tiempos del proceso, con los datos a los que usted tiene acceso."
        actions={
          selected ? (
            <Button asChild variant="outline">
              <a href={`/api/reportes/export?vacante=${selected.id}`}>
                <DownloadIcon aria-hidden /> Exportar CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-1 flex-col gap-1 sm:max-w-xs">
          <label htmlFor="vacante" className="text-sm font-medium">
            Vacante
          </label>
          <NativeSelect id="vacante" name="vacante" defaultValue={params.vacante ?? ""}>
            <NativeSelectOption value="">Todas las vacantes</NativeSelectOption>
            {vacancies.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.title} · {v.department}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="desde" className="text-sm font-medium">
            Desde
          </label>
          <Input id="desde" type="date" name="desde" defaultValue={params.desde ?? ""} className="sm:w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="hasta" className="text-sm font-medium">
            Hasta
          </label>
          <Input id="hasta" type="date" name="hasta" defaultValue={params.hasta ?? ""} className="sm:w-40" />
        </div>
        <Button type="submit">Ver reporte</Button>
      </form>
      {!selected ? (
        <p className="text-xs text-muted-foreground">Seleccione una vacante para habilitar la exportación a CSV (la exportación no aplica el rango de fechas).</p>
      ) : null}

      {report.truncated ? (
        <p className="rounded-md border border-warning-foreground/40 bg-warning px-4 py-3 text-sm text-warning-foreground">
          Hay más registros de los que este reporte puede leer; las cifras son parciales. Filtre por una vacante o un rango de fechas.
        </p>
      ) : null}

      {report.totalApplications === 0 ? (
        <EmptyState title="No hay postulaciones para este ámbito" />
      ) : (
        <div className="space-y-6">
          <StatTiles tiles={tiles} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Postulaciones en el tiempo</CardTitle>
                <CardDescription>Recibidas por {report.trend.granularity}, según la fecha de postulación.</CardDescription>
              </CardHeader>
              <CardContent>
                <TrendChart trend={report.trend} />
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Embudo por etapa</CardTitle>
                <CardDescription>
                  {report.totalApplications} postulaciones. «Llegaron» cuenta las que alcanzaron la etapa o una posterior
                  del recorrido principal; la conversión compara con la etapa anterior.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FunnelChart steps={report.funnel} />
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Etapa</TableHead>
                        <TableHead className="text-right">Llegaron</TableHead>
                        <TableHead className="text-right">Conversión</TableHead>
                        <TableHead className="text-right">Hoy en esta etapa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.funnel.map((step) => (
                        <TableRow key={step.status}>
                          <TableCell>{APPLICATION_STATUS_LABELS[step.status]}</TableCell>
                          <TableCell className="text-right tabular-nums">{step.reached}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {step.conversion === null ? "—" : formatPercent(step.conversion * 100)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{step.current}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Fuera del recorrido principal (estado actual)</h3>
                  <ul className="space-y-3">
                    {report.side.map((s) => (
                      <BarRow key={s.status} label={APPLICATION_STATUS_LABELS[s.status]} value={s.current} max={maxSide} />
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fuentes de candidatos</CardTitle>
                <CardDescription>Candidatos distintos por fuente y cuántos llegaron a seleccionado (calidad de la fuente).</CardDescription>
              </CardHeader>
              <CardContent>
                <SourcesChart sources={report.sources} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tiempos del proceso</CardTitle>
                <CardDescription>
                  Calculados con el historial de cambios de estado. Solo incluye postulaciones que ya cambiaron de estado.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {report.times.perStage.length === 0 ? (
                  <EmptyState title="Aún no hay cambios de estado para calcular tiempos" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tiempo en la etapa</TableHead>
                          <TableHead className="text-right">Promedio</TableHead>
                          <TableHead className="text-right">Mediana</TableHead>
                          <TableHead className="text-right">Casos</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.times.perStage.map((t) => (
                          <TableRow key={t.status}>
                            <TableCell>{APPLICATION_STATUS_LABELS[t.status]}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatHours(t.avgHours)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatHours(t.medianHours)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t.samples}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-sm">
                  <span className="font-medium">Hasta la decisión</span> (seleccionado o no seleccionado):{" "}
                  {report.times.toDecision
                    ? `${formatHours(report.times.toDecision.avgHours)} de promedio, ${formatHours(report.times.toDecision.medianHours)} de mediana (${report.times.toDecision.samples} casos).`
                    : "todavía no hay decisiones registradas."}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
