import type { Metadata } from "next";
import Link from "next/link";
import { BellRingIcon } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { APPLICATION_EVENT_LABELS, APPLICATION_STATUS_LABELS, SYSTEM_ACTOR_LABEL } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardSummary } from "@/modules/dashboard/queries";
import { listPendingOpinions } from "@/modules/notifications/queries";
import { Constants } from "@/types/database";

export const metadata: Metadata = { title: "Panel" };

const FINAL_STATUSES = new Set(["seleccionado", "no_seleccionado", "retirado"]);

function StatTile({ label, value, hint, href }: { label: string; value: number; hint: string; href?: string }) {
  const content = (
    <Card className="h-full gap-1 py-4 transition-colors hover:bg-muted/40">
      <CardHeader className="px-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default async function DashboardPage() {
  const user = await requirePageUser();
  const supabase = await createSupabaseServerClient();
  const [summary, pendingOpinions] = await Promise.all([
    getDashboardSummary(supabase),
    listPendingOpinions(supabase, user.id),
  ]);

  const byStatus = Constants.public.Enums.application_status.map((status) => ({
    status,
    total: summary.applications_by_status[status] ?? 0,
  }));
  const inProcess = byStatus.filter((s) => !FINAL_STATUSES.has(s.status)).reduce((sum, s) => sum + s.total, 0);
  const maxStage = Math.max(1, ...byStatus.map((s) => s.total));

  return (
    <>
      <PageHeader
        title={`Hola, ${user.fullName.split(" ")[0]}`}
        description="Indicadores calculados con los datos registrados en la plataforma."
      />

      {pendingOpinions.length > 0 ? (
        <section
          aria-label="Pendientes de su opinión"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:bg-amber-950 dark:text-amber-50"
        >
          <h2 className="flex items-center gap-2 font-medium">
            <BellRingIcon className="size-4" aria-hidden />
            {pendingOpinions.length === 1
              ? "Le pidieron su opinión sobre 1 postulación"
              : `Le pidieron su opinión sobre ${pendingOpinions.length} postulaciones`}
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {pendingOpinions.map((item) => (
              <li key={item.id}>
                <Link href={`/postulaciones/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                  {item.candidate_name}
                </Link>{" "}
                · {item.vacancy_title} · desde el {formatDateTime(item.opinion_requested_at)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Para responder, registre una observación en cada postulación.</p>
        </section>
      ) : null}

      <section aria-label="Indicadores principales" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Vacantes publicadas" value={summary.active_vacancies} hint={`${summary.draft_vacancies} en borrador`} href="/vacantes" />
        <StatTile label="Postulaciones en proceso" value={inProcess} hint="Sin decisión final registrada" />
        <StatTile
          label="Evaluaciones pendientes"
          value={summary.pending_evaluations}
          hint="Sin evaluación o con criterios actualizados"
        />
        <StatTile label="Revisiones pendientes" value={summary.pending_reviews} hint="Evaluaciones sin revisión de RRHH" />
      </section>

      {summary.vacancies_pending_criteria > 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50">
          {summary.vacancies_pending_criteria === 1
            ? "Hay 1 vacante con criterios de evaluación sin aprobar."
            : `Hay ${summary.vacancies_pending_criteria} vacantes con criterios de evaluación sin aprobar.`}{" "}
          No se pueden evaluar candidatos hasta que RRHH los apruebe.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Candidatos por etapa</CardTitle>
            <CardDescription>Postulaciones de vacantes no archivadas.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {byStatus.map(({ status, total }) => (
                <li key={status} className="grid grid-cols-[10rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <span className="truncate text-muted-foreground">{APPLICATION_STATUS_LABELS[status]}</span>
                  <span className="h-2 rounded-full bg-muted" aria-hidden>
                    <span
                      className="block h-2 rounded-full bg-primary"
                      style={{ width: total === 0 ? 0 : `${Math.max(4, (total / maxStage) * 100)}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums">{total}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Candidatos por vacante publicada</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.candidates_per_vacancy.length === 0 ? (
              <EmptyState title="No hay vacantes publicadas" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vacante</TableHead>
                    <TableHead className="text-right">Candidatos</TableHead>
                    <TableHead className="text-right">Sin evaluar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.candidates_per_vacancy.map((vacancy) => (
                    <TableRow key={vacancy.id}>
                      <TableCell className="max-w-56 truncate">
                        <Link href={`/vacantes/${vacancy.id}`} className="font-medium hover:underline">
                          {vacancy.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">{vacancy.department}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{vacancy.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{vacancy.without_evaluation}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actividad reciente</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.recent_activity.length === 0 ? (
              <EmptyState title="Aún no hay actividad registrada" />
            ) : (
              <ul className="divide-y text-sm">
                {summary.recent_activity.map((event) => (
                  <li key={event.id} className="py-2">
                    <Link href={`/postulaciones/${event.application_id}`} className="font-medium hover:underline">
                      {event.candidate_name}
                    </Link>{" "}
                    · <span className="text-muted-foreground">{event.vacancy_title}</span>
                    <div className="text-xs text-muted-foreground">
                      {APPLICATION_EVENT_LABELS[event.event_type]}
                      {event.event_type === "cambio_estado" && event.from_status && event.to_status
                        ? `: ${APPLICATION_STATUS_LABELS[event.from_status]} → ${APPLICATION_STATUS_LABELS[event.to_status]}`
                        : ""}
                      {" · "}
                      {event.actor_name ?? SYSTEM_ACTOR_LABEL} · {formatDateTime(event.created_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Próximos módulos</CardTitle>
            <CardDescription>Indicadores que se habilitarán cuando existan sus módulos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Entrevistas próximas — módulo de entrevistas (Etapa 3).</p>
            <p>Feedback pendiente de aprobación — módulo de feedback (Etapa 2).</p>
            <p>Correos pendientes, enviados o fallidos — bandeja de notificaciones (Etapa 3).</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
