import type { Metadata } from "next";
import Link from "next/link";
import { BellRingIcon, ShieldAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { BotStatusPanel } from "@/components/app-shell/bot-status-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { APPLICATION_EVENT_LABELS, APPLICATION_STATUS_LABELS, INTERVIEW_MODALITY_LABELS, SYSTEM_ACTOR_LABEL } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { InterviewOutcomeBadge, LocationText } from "@/components/interviews/interview-item";
import { can } from "@/lib/auth/permissions";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { dayLabel, isoToLima } from "@/modules/interviews/datetime";
import { listUpcomingInterviews } from "@/modules/interviews/queries";
import { getBotDailySummary } from "@/modules/portals/daily-summary";
import { listBotPortalStatuses } from "@/modules/portals/queries";
import { getDashboardSummary } from "@/modules/dashboard/queries";
import { getOpenIncidentsSummary } from "@/modules/incidents/queries";
import { countOpenAiJobs, describeAiWorker, getAiWorkerStatus } from "@/modules/evaluation/ai-queue";
import { getAiStatus } from "@/modules/evaluation/service";
import { listPendingOpinions } from "@/modules/notifications/queries";
import { LEGACY_STATUSES } from "@/modules/applications/schemas";
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
  const canSeeInterviews = can(user.role, "applications:manage");
  const botConfigured = Boolean(getServerEnv().PORTAL_BOT_SECRET);
  const ai = getAiStatus();
  // Solo el personal que evalúa ve (y puede leer, por RLS) el estado del worker.
  const aiQueued = ai.available && ai.queued && can(user.role, "evaluations:run");
  const [summary, pendingOpinions, upcomingInterviews, botStatuses, botDaily, aiWorker, incidents] = await Promise.all([
    getDashboardSummary(supabase),
    listPendingOpinions(supabase, user.id),
    canSeeInterviews ? listUpcomingInterviews(supabase, { limit: 5, days: 7 }) : Promise.resolve([]),
    botConfigured
      ? listBotPortalStatuses(supabase).catch((error: unknown) => {
          logServerError("panel.bot_status", error);
          return [];
        })
      : Promise.resolve([]),
    botConfigured
      ? getBotDailySummary(supabase).catch((error: unknown) => {
          logServerError("panel.bot_daily", error);
          return { publishedToday: 0, applicantsToday: 0 };
        })
      : Promise.resolve({ publishedToday: 0, applicantsToday: 0 }),
    // Cola de IA con el worker (AI_PROVIDER=claude-cli): ¿la está atendiendo?
    aiQueued
      ? Promise.all([getAiWorkerStatus(supabase), countOpenAiJobs(supabase)])
          .then(([status, openJobs]) => ({ notice: describeAiWorker(status, formatDateTime), openJobs }))
          .catch((error: unknown) => {
            logServerError("panel.ai_worker", error);
            return { notice: null, openJobs: 0 };
          })
      : Promise.resolve({ notice: null, openJobs: 0 }),
    // Incidentes de seguridad sin cerrar (solo administración; los simulacros no cuentan).
    can(user.role, "users:manage")
      ? getOpenIncidentsSummary(supabase).catch((error: unknown) => {
          logServerError("panel.incidents", error);
          return { count: 0, nextDueAt: null, overdue: false };
        })
      : Promise.resolve({ count: 0, nextDueAt: null, overdue: false }),
  ]);

  const byStatus = Constants.public.Enums.application_status
    .map((status) => ({ status, total: summary.applications_by_status[status] ?? 0 }))
    // Los estados antiguos ya no se ofrecen: solo aparecen si aún queda alguien en ellos.
    .filter(({ status, total }) => total > 0 || !LEGACY_STATUSES.includes(status));
  const inProcess = byStatus.filter((s) => !FINAL_STATUSES.has(s.status)).reduce((sum, s) => sum + s.total, 0);
  const maxStage = Math.max(1, ...byStatus.map((s) => s.total));

  return (
    <>
      <PageHeader
        title={`Hola, ${user.fullName.split(" ")[0]}`}
        description="Indicadores calculados con los datos registrados en la plataforma."
      />

      {incidents.count > 0 ? (
        <section
          role="alert"
          aria-label="Incidentes de seguridad abiertos"
          className="rounded-lg border border-destructive bg-danger px-4 py-3 text-danger-foreground"
        >
          <h2 className="flex items-start gap-2 font-medium">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {incidents.count === 1 ? "Hay 1 incidente de seguridad abierto" : `Hay ${incidents.count} incidentes de seguridad abiertos`}
              {incidents.nextDueAt
                ? ` · el plazo para avisar a la Autoridad ${incidents.overdue ? "venció" : "vence"} el ${formatDateTime(incidents.nextDueAt.toISOString())}`
                : ""}
            </span>
          </h2>
          <Link href="/configuracion/incidentes" className="mt-1 inline-block text-sm font-medium underline underline-offset-4">
            Ver los incidentes
          </Link>
        </section>
      ) : null}

      {aiWorker.notice ? (
        <p
          role="status"
          className="rounded-md border border-warning-foreground/40 bg-warning px-4 py-3 text-sm text-warning-foreground"
        >
          {aiWorker.notice.message}
          {aiWorker.openJobs > 0
            ? ` En cola: ${aiWorker.openJobs} ${aiWorker.openJobs === 1 ? "evaluación" : "evaluaciones"}.`
            : null}
        </p>
      ) : null}

      {pendingOpinions.length > 0 ? (
        <section
          aria-label="Pendientes de su opinión"
          className="rounded-lg border border-warning-foreground/40 bg-warning px-4 py-3 text-warning-foreground"
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
        <StatTile
          label="Postulaciones nuevas"
          value={summary.applications_by_status.nuevo ?? 0}
          hint="Aún sin revisar: ver la bandeja"
          href="/postulaciones"
        />
      </section>

      {botConfigured ? <BotStatusPanel statuses={botStatuses} daily={botDaily} /> : null}

      {summary.vacancies_pending_criteria > 0 ? (
        <p className="rounded-md border border-warning-foreground/40 bg-warning px-4 py-3 text-sm text-warning-foreground">
          {summary.vacancies_pending_criteria === 1
            ? "Hay 1 vacante con criterios de evaluación sin aprobar."
            : `Hay ${summary.vacancies_pending_criteria} vacantes con criterios de evaluación sin aprobar.`}{" "}
          No se pueden evaluar candidatos hasta que RRHH los apruebe.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Candidatos por etapa</CardTitle>
            <CardDescription>Postulaciones de vacantes no archivadas.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {byStatus.map(({ status, total }) => (
                <li key={status} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_2.5rem]">
                  <span className="leading-tight text-muted-foreground">{APPLICATION_STATUS_LABELS[status]}</span>
                  <span className="h-2 rounded-full bg-muted" aria-hidden>
                    <span
                      className="block h-2 rounded-full bg-brand"
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
                    <TableHead className="text-right max-sm:px-1">Candidatos</TableHead>
                    <TableHead className="text-right max-sm:px-1">Sin evaluar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.candidates_per_vacancy.map((vacancy) => (
                    <TableRow key={vacancy.id}>
                      <TableCell className="whitespace-normal">
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
          <CardContent className="space-y-3">
            {summary.recent_activity.length === 0 ? (
              <EmptyState title="Aún no hay actividad registrada" />
            ) : (
              <ul className="divide-y text-sm">
                {summary.recent_activity.slice(0, 5).map((event) => (
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
            <Link href="/auditoria" className="text-sm font-medium text-brand underline underline-offset-4">
              Ver toda la actividad
            </Link>
          </CardContent>
        </Card>

        {canSeeInterviews ? (
          <Card>
            <CardHeader>
              <CardTitle>Próximas entrevistas</CardTitle>
              <CardDescription>Las próximas 5 de los siguientes 7 días, en hora de Perú.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {upcomingInterviews.length === 0 ? (
                <EmptyState title="No hay entrevistas en los próximos 7 días" />
              ) : (
                <ul className="divide-y text-sm">
                  {upcomingInterviews.map((interview) => (
                    <li key={interview.id} className="space-y-0.5 py-2">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="first-letter:uppercase">{dayLabel(interview.scheduled_at)}</span>
                        <span className="font-normal text-muted-foreground">· {isoToLima(interview.scheduled_at).time}</span>
                        <InterviewOutcomeBadge status={interview.status} result={interview.result} />
                      </div>
                      <div>
                        <Link href={`/postulaciones/${interview.applications.id}`} className="font-medium hover:underline">
                          {interview.applications.candidates?.full_name ?? "Candidato"}
                        </Link>{" "}
                        · <span className="text-muted-foreground">{interview.applications.vacancies?.title}</span>
                      </div>
                      {interview.location ? (
                        <div className="text-xs text-muted-foreground">
                          {INTERVIEW_MODALITY_LABELS[interview.modality]} · <LocationText location={interview.location} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/entrevistas" className="text-sm font-medium text-brand underline underline-offset-4">
                Ver todas las entrevistas
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
