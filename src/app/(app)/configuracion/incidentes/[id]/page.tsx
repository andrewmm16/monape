import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2Icon, CircleDashedIcon, MinusCircleIcon } from "lucide-react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageHeader } from "@/components/common/page-header";
import { EventForm } from "@/components/incidents/event-form";
import { DrillBadge, IncidentStatusBadge, NotificationDeadlineText, SeverityBadge } from "@/components/incidents/incident-badges";
import { CloseIncidentDialog, ContainButton, ReviewForm } from "@/components/incidents/incident-status-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { REVIEW_BUSINESS_DAYS, describeHours, incidentSteps, notificationDeadline, reviewDeadline } from "@/modules/incidents/deadlines";
import { SECRET_ROTATIONS } from "@/modules/incidents/procedures";
import { getIncident, getSecurityOfficer, listIncidentEvents } from "@/modules/incidents/queries";
import { EVENT_KIND_LABELS, SEVERITY_LABELS } from "@/modules/incidents/schemas";
import { isoToLima } from "@/modules/interviews/datetime";

export const metadata: Metadata = { title: "Incidente de seguridad" };

const DAY_MS = 24 * 60 * 60 * 1000;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

export default async function IncidentDetailPage({ params }: PageProps<"/configuracion/incidentes/[id]">) {
  const user = await requirePageUser();
  if (!can(user.role, "users:manage")) {
    return <AccessDenied message="Solo la administración gestiona los incidentes de seguridad." />;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const incident = await getIncident(supabase, id);
  if (!incident) notFound();
  const [events, officer] = await Promise.all([listIncidentEvents(supabase, id), getSecurityOfficer(supabase)]);

  const now = new Date();
  const deadlineIncident = {
    severity: incident.severity,
    isDrill: incident.is_drill,
    affectedData: incident.affected_data,
    detectedAt: incident.detected_at,
  };
  const deadlineEvents = events.map((event) => ({ kind: event.kind, recipient: event.recipient }));
  const deadline = notificationDeadline(deadlineIncident, deadlineEvents, now);
  const review = reviewDeadline({ severity: incident.severity, closedAt: incident.closed_at, reviewDoneAt: incident.review_done_at }, now);
  const steps = incidentSteps(
    { ...deadlineIncident, status: incident.status, affectedPeople: incident.affected_people, closedAt: incident.closed_at, reviewDoneAt: incident.review_done_at },
    deadlineEvents,
    now,
  );

  const incidentUrl = new URL(`/configuracion/incidentes/${incident.id}`, getServerEnv().APP_URL).toString();
  // Sin datos de candidatos: solo título, gravedad, plazo y enlace.
  const deadlineText = !deadline.applies
    ? "no exige aviso a la Autoridad"
    : deadline.fulfilled
      ? "la Autoridad ya fue avisada"
      : `${describeHours(deadline.hoursRemaining)} (${formatDateTime(deadline.dueAt.toISOString())})`;
  const mailto =
    `mailto:${encodeURIComponent(officer?.email ?? "")}` +
    `?subject=${encodeURIComponent(`${incident.is_drill ? "[SIMULACRO] " : ""}Incidente de seguridad: ${incident.title}`)}` +
    `&body=${encodeURIComponent(
      [
        `Incidente: ${incident.title}`,
        `Gravedad: ${SEVERITY_LABELS[incident.severity].toLowerCase()}`,
        `Plazo de aviso a la Autoridad: ${deadlineText}`,
        `Detalle: ${incidentUrl}`,
      ].join("\r\n"),
    )}`;
  const auditFrom = isoToLima(new Date(new Date(incident.detected_at).getTime() - DAY_MS)).date;
  const closed = incident.status === "cerrado";

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/configuracion/incidentes" className="hover:underline">← Incidentes de seguridad</Link>}
        title={incident.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
            {incident.is_drill ? <DrillBadge /> : null}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <a href={mailto}>Avisar al oficial</a>
            </Button>
            {incident.status === "abierto" ? <ContainButton incidentId={incident.id} /> : null}
            {closed ? null : <CloseIncidentDialog incidentId={incident.id} />}
          </>
        }
      />

      <section
        aria-label="Plazo de aviso a la Autoridad"
        className={cn(
          "rounded-lg border px-4 py-3",
          deadline.urgent ? "border-destructive bg-danger text-danger-foreground" : "bg-card",
        )}
      >
        <h2 className="text-sm font-medium">
          Plazo de 48 h para avisar a la Autoridad{deadline.practice ? " · práctica (simulacro)" : ""}
        </h2>
        <p className="mt-1 text-2xl font-semibold tracking-tight">
          {!deadline.applies ? (
            "No exigido"
          ) : deadline.fulfilled ? (
            "Cumplido"
          ) : (
            <NotificationDeadlineText deadline={deadline} className="text-inherit" />
          )}
        </p>
        <p className="mt-1 text-sm">
          {deadline.applies
            ? `Vence el ${formatDateTime(deadline.dueAt.toISOString())}, 48 h después de ${formatDateTime(incident.detected_at)}.`
            : "Gravedad baja y sin datos afectados."}
          {deadline.applies && !deadline.fulfilled
            ? " Se da por cumplido al anotar una notificación a la Autoridad Nacional de Protección de Datos Personales."
            : null}
        </p>
        {officer ? null : (
          <p className="mt-2 text-sm">No hay oficial de datos personales designado: mientras tanto, decide Gerencia.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Datos del incidente</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label="Detectado el">{formatDateTime(incident.detected_at)}</Detail>
              <Detail label="Quién lo detectó">{incident.detected_by_text || "—"}</Detail>
              <Detail label="Qué pasó">{incident.description || "—"}</Detail>
              <Detail label="Qué datos afectó">{incident.affected_data || "—"}</Detail>
              <Detail label="Personas afectadas">{incident.affected_people ?? "Aún no se sabe"}</Detail>
              <Detail label="Datos sensibles">{incident.sensitive_data ? "Sí" : "No"}</Detail>
              {closed ? (
                <>
                  <Detail label="Cerrado el">{formatDateTime(incident.closed_at)}</Detail>
                  <Detail label="Causa">{incident.cause}</Detail>
                  <Detail label="Qué se cambió para que no se repita">{incident.prevention}</Detail>
                </>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Los 6 pasos de la política</CardTitle>
            <CardDescription>Se marcan solos según el estado y la bitácora.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {steps.map((step, index) => {
                const Icon = step.state === "hecho" ? CheckCircle2Icon : step.state === "no_aplica" ? MinusCircleIcon : CircleDashedIcon;
                return (
                  <li key={step.key} className="flex items-start gap-3 text-sm">
                    <Icon
                      className={cn("mt-0.5 size-5 shrink-0", step.state === "hecho" ? "text-brand" : "text-muted-foreground")}
                      aria-hidden
                    />
                    <div>
                      <div className="font-medium">
                        {index + 1}. {step.label}
                        <span className="sr-only">
                          {step.state === "hecho" ? ": hecho" : step.state === "no_aplica" ? ": no aplica" : ": pendiente"}
                        </span>
                      </div>
                      <div className="text-muted-foreground">{step.detail}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bitácora</CardTitle>
          <CardDescription>
            Acciones, notificaciones y notas, con su hora y autor. Lo anotado no se puede editar ni borrar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay nada anotado.</p>
          ) : (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuándo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead>Autor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell data-label="Cuándo">{formatDateTime(event.occurred_at)}</TableCell>
                    <TableCell data-label="Tipo">{EVENT_KIND_LABELS[event.kind]}</TableCell>
                    <TableCell data-label="Detalle" className="whitespace-normal">
                      {event.recipient ? <div className="font-medium">A: {event.recipient}</div> : null}
                      <div className="break-words whitespace-pre-line">{event.description}</div>
                    </TableCell>
                    <TableCell data-label="Autor" className="whitespace-normal">
                      {event.author?.full_name ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Agregar a la bitácora</h3>
            <EventForm incidentId={incident.id} />
          </div>
        </CardContent>
      </Card>

      {closed ? (
        <Card>
          <CardHeader>
            <CardTitle>Revisión</CardTitle>
            <CardDescription>
              {review.applies
                ? `Dentro de ${REVIEW_BUSINESS_DAYS} días hábiles desde el cierre (lunes a viernes, sin contar los feriados nacionales). Vence el ${formatDate(review.dueDate)}.`
                : "La revisión es obligatoria solo en gravedad media o alta; puede hacerla igual."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {incident.review_done_at ? (
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">Registrada el {formatDateTime(incident.review_done_at)}.</p>
                <p className="break-words whitespace-pre-line">{incident.review_notes}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {review.overdue ? <p className="text-sm font-medium text-destructive">La revisión está vencida.</p> : null}
                <ReviewForm incidentId={incident.id} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Procedimientos rápidos</CardTitle>
          <CardDescription>Los pasos completos están en la política de incidentes (docs/politica-incidentes.md).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/usuarios">Desactivar una cuenta</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/auditoria?from=${auditFrom}`}>Ver la auditoría</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/configuracion/portal-candidato">Apagar el portal del candidato</Link>
            </Button>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Una clave secreta expuesta se rota siempre</h3>
            <p className="text-sm text-muted-foreground">
              Generar una nueva, reemplazarla y volver a desplegar. Que la clave vieja «no la haya visto nadie» no basta.
            </p>
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>Secreto</TableHead>
                  <TableHead>Dónde vive</TableHead>
                  <TableHead>Cómo se rota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SECRET_ROTATIONS.map((row) => (
                  <TableRow key={row.secret}>
                    <TableCell className="font-mono text-xs break-all whitespace-normal">{row.secret}</TableCell>
                    <TableCell data-label="Dónde vive" className="whitespace-normal">
                      {row.where}
                    </TableCell>
                    <TableCell data-label="Cómo se rota" className="whitespace-normal">
                      {row.how}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
