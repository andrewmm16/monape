import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { BarRow } from "@/components/reports/bar-row";
import { DetailCard } from "@/components/reports/detail-card";
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
import { APPLICATION_STATUS_LABELS, CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LEGACY_STATUSES } from "@/modules/applications/schemas";
import { computeInsights, computeTrendDelta, formatHours, type Insight } from "@/modules/reports/metrics";
import { buildReportHref, isSameDetail, portalRobotLabel, type ReportDetail } from "@/modules/reports/detail";
import { getPortalRobotData, getReport, getReportDetail, listReportVacancies, reportParamsSchema } from "@/modules/reports/queries";

export const metadata: Metadata = { title: "Reportes" };

/** Convierte una observación automática (datos crudos) a una frase legible. */
function insightText(insight: Insight): string {
  switch (insight.kind) {
    case "trend":
      return `Las postulaciones ${insight.direction === "up" ? "subieron" : "bajaron"} ${insight.pct} % respecto ${insight.granularity === "semana" ? "a la semana" : "al mes"} anterior.`;
    case "funnel-drop":
      return `La mayor caída del embudo está entre «${APPLICATION_STATUS_LABELS[insight.from]}» y «${APPLICATION_STATUS_LABELS[insight.to]}»: solo avanza el ${formatPercent(insight.conversion * 100)}.`;
    case "best-source":
      return `La fuente con mejor conversión a seleccionado es ${CANDIDATE_SOURCE_LABELS[insight.source]} (${formatPercent(insight.selectedShare * 100)}, ${insight.selected} seleccionado${insight.selected === 1 ? "" : "s"}).`;
  }
}

export default async function ReportsPage({ searchParams }: PageProps<"/reportes">) {
  const user = await requirePageUser();
  // Reportes y exportación son solo para el personal de RRHH.
  if (!can(user.role, "applications:manage")) redirect("/panel");

  const params = reportParamsSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const detail = params.detalle;
  const [vacancies, report, robot, detailData] = await Promise.all([
    listReportVacancies(supabase),
    getReport(supabase, params),
    getPortalRobotData(supabase, params),
    detail ? getReportDetail(supabase, params, detail) : Promise.resolve(null),
  ]);
  const hrefFor = (target: ReportDetail) => buildReportHref(params, target);
  const closeHref = buildReportHref(params);
  const detailCard =
    detail && detailData ? <DetailCard detail={detail} rows={detailData.rows} hasMore={detailData.hasMore} closeHref={closeHref} /> : null;

  const selected = vacancies.find((v) => v.id === params.vacante);
  const maxSide = Math.max(1, ...report.side.map((s) => s.current));

  const total = report.kpis.total;
  const pctOf = (count: number) => (total > 0 ? `${formatPercent((count / total) * 100)} del total` : undefined);
  const trendDelta = computeTrendDelta(report.trend);
  const insights = computeInsights({
    funnel: report.funnel,
    sources: report.sources,
    trend: report.trend,
    kpis: report.kpis,
  });

  const tiles: StatTile[] = [
    {
      label: "Postulaciones",
      value: String(report.kpis.total),
      spark: report.trend.points.length >= 2 ? report.trend.points.map((point) => point.count) : undefined,
      delta: trendDelta
        ? {
            text: trendDelta.pct === null ? "nuevo" : `${trendDelta.pct > 0 ? "+" : ""}${Math.round(trendDelta.pct)}%`,
            direction: trendDelta.direction,
            tone: trendDelta.direction === "up" ? "positive" : trendDelta.direction === "down" ? "negative" : "neutral",
          }
        : undefined,
      hint: trendDelta ? `vs ${report.trend.granularity} anterior` : undefined,
    },
    { label: "En proceso", value: String(report.kpis.inProcess), hint: pctOf(report.kpis.inProcess) },
    { label: "Seleccionados", value: String(report.kpis.selected), hint: pctOf(report.kpis.selected) },
    { label: "Descartados", value: String(report.kpis.discarded), hint: pctOf(report.kpis.discarded) },
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
        <Button type="submit" variant="outline">Aplicar</Button>
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

          {insights.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">En resumen</CardTitle>
                <CardDescription>Lecturas automáticas de los datos de arriba, para saber dónde mirar primero.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {insights.map((insight, index) => (
                    <li key={index} className="flex gap-2">
                      <span aria-hidden className="text-brand">
                        •
                      </span>
                      <span>{insightText(insight)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

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
                <FunnelChart steps={report.funnel} hrefFor={hrefFor} current={detail} />
                {detail?.kind === "etapa" ? detailCard : null}
                <div className="overflow-x-auto">
                  <Table stacked>
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
                          <TableCell data-label="Llegaron" className="text-right tabular-nums">{step.reached}</TableCell>
                          <TableCell data-label="Conversión" className="text-right tabular-nums">
                            {step.conversion === null ? "—" : formatPercent(step.conversion * 100)}
                          </TableCell>
                          <TableCell data-label="Hoy en esta etapa" className="text-right tabular-nums">{step.current}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Fuera del recorrido principal (estado actual)</h3>
                  <ul className="space-y-3">
                    {report.side
                      .filter((s) => s.current > 0 || !LEGACY_STATUSES.includes(s.status))
                      .map((s) => (
                        <BarRow key={s.status} label={APPLICATION_STATUS_LABELS[s.status]} value={s.current} max={maxSide} />
                      ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card className={detail && detail.kind !== "etapa" ? "lg:col-span-2" : undefined}>
              <CardHeader>
                <CardTitle>Fuentes de candidatos</CardTitle>
                <CardDescription>Candidatos distintos por fuente y cuántos llegaron a seleccionado (calidad de la fuente).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <SourcesChart sources={report.sources} hrefFor={hrefFor} current={detail} />
                {detail?.kind === "fuente" ? detailCard : null}
                {report.portals.length > 0 ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Por portal</h3>
                    <Table stacked>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Portal</TableHead>
                          <TableHead className="text-right">Postulaciones</TableHead>
                          <TableHead className="text-right">A seleccionado</TableHead>
                          {robot.published ? <TableHead className="text-right">Publicadas por el robot</TableHead> : null}
                          {robot.statuses ? <TableHead>Robot</TableHead> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.portals.map((portal) => {
                          const target: ReportDetail = { kind: "portal", value: portal.portal };
                          const selectedPortal = isSameDetail(detail, target);
                          const robotLabel = portalRobotLabel(robot.statuses?.get(portal.portal));
                          return (
                            <TableRow key={portal.portal} data-state={selectedPortal ? "selected" : undefined}>
                              <TableCell className="whitespace-normal">
                                <Link
                                  href={hrefFor(target)}
                                  aria-current={selectedPortal ? "true" : undefined}
                                  className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  {portal.portal}
                                </Link>
                              </TableCell>
                              <TableCell data-label="Postulaciones" className="text-right tabular-nums">{portal.applications}</TableCell>
                              <TableCell data-label="A seleccionado" className="text-right tabular-nums">{portal.selected}</TableCell>
                              {robot.published ? (
                                <TableCell data-label="Vacantes publicadas por el robot" className="text-right tabular-nums">
                                  {robot.published.get(portal.portal) ?? 0}
                                </TableCell>
                              ) : null}
                              {robot.statuses ? (
                                <TableCell data-label="Robot">{robotLabel ? robotLabel.label : "—"}</TableCell>
                              ) : null}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
                {detail?.kind === "portal" ? detailCard : null}
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
                    <Table stacked>
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
                            <TableCell data-label="Promedio" className="text-right tabular-nums">{formatHours(t.avgHours)}</TableCell>
                            <TableCell data-label="Mediana" className="text-right tabular-nums">{formatHours(t.medianHours)}</TableCell>
                            <TableCell data-label="Casos" className="text-right tabular-nums">{t.samples}</TableCell>
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
