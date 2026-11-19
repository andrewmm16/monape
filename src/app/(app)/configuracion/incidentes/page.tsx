import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { DrillButton } from "@/components/incidents/drill-button";
import { DrillBadge, IncidentStatusBadge, NotificationDeadlineText, SeverityBadge } from "@/components/incidents/incident-badges";
import { IncidentFormDialog } from "@/components/incidents/incident-form-dialog";
import { OfficerForm } from "@/components/incidents/officer-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notificationDeadline } from "@/modules/incidents/deadlines";
import { getLastDrillAt, getSecurityOfficer, listIncidents } from "@/modules/incidents/queries";

export const metadata: Metadata = { title: "Incidentes de seguridad" };

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export default async function IncidentsPage() {
  const user = await requirePageUser();
  if (!can(user.role, "users:manage")) {
    return <AccessDenied message="Solo la administración gestiona los incidentes de seguridad." />;
  }
  const supabase = await createSupabaseServerClient();
  const [incidents, officer, lastDrillAt] = await Promise.all([
    listIncidents(supabase),
    getSecurityOfficer(supabase),
    getLastDrillAt(supabase),
  ]);
  const now = new Date();
  const drillOutdated = !lastDrillAt || now.getTime() - new Date(lastDrillAt).getTime() > YEAR_MS;

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Incidentes de seguridad"
        description="Registro de incidentes, plazos de aviso y simulacros, según la política de incidentes."
        actions={<IncidentFormDialog />}
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Oficial de datos personales</CardTitle>
            <CardDescription>
              Decide y firma las notificaciones a la Autoridad y a las personas afectadas.
              {officer?.designatedAt ? ` Designado el ${formatDate(officer.designatedAt)}.` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {officer ? null : (
              <p role="status" className="rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground">
                Todavía no hay un oficial designado. La política lo exige; mientras tanto, decide Gerencia.
              </p>
            )}
            <OfficerForm initialValues={{ name: officer?.name ?? "", email: officer?.email ?? "" }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Simulacro</CardTitle>
            <CardDescription>
              Una vez al año, y antes de pasar a producción, un simulacro de mesa de 30 minutos. Caso sugerido: «la clave del worker de
              IA apareció en un chat».
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm">
              Último simulacro: <span className="font-medium">{lastDrillAt ? formatDate(lastDrillAt) : "ninguno todavía"}</span>
            </p>
            {drillOutdated ? (
              <p role="status" className="rounded-md border border-warning-foreground/40 bg-warning px-3 py-2 text-sm text-warning-foreground">
                {lastDrillAt ? "El último simulacro tiene más de un año." : "Aún no se hizo ningún simulacro."} Conviene hacer uno.
              </p>
            ) : null}
            <DrillButton />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incidentes</CardTitle>
          <CardDescription>Los abiertos primero. El plazo de 48 h corre desde que se tomó conocimiento.</CardDescription>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <EmptyState title="No hay incidentes registrados" />
          ) : (
            <Table stacked>
              <TableHeader>
                <TableRow>
                  <TableHead>Incidente</TableHead>
                  <TableHead>Detectado</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Plazo de aviso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((incident) => {
                  const deadline = notificationDeadline(
                    {
                      severity: incident.severity,
                      isDrill: incident.is_drill,
                      affectedData: incident.affected_data,
                      detectedAt: incident.detected_at,
                    },
                    incident.events,
                    now,
                  );
                  return (
                    <TableRow key={incident.id}>
                      <TableCell className="whitespace-normal">
                        <Link href={`/configuracion/incidentes/${incident.id}`} className="font-medium hover:underline">
                          {incident.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <SeverityBadge severity={incident.severity} />
                          {incident.is_drill ? <DrillBadge /> : null}
                        </div>
                      </TableCell>
                      <TableCell data-label="Detectado" className="whitespace-normal">{formatDateTime(incident.detected_at)}</TableCell>
                      <TableCell data-label="Estado">
                        <IncidentStatusBadge status={incident.status} />
                      </TableCell>
                      <TableCell data-label="Plazo de aviso" className="whitespace-normal">
                        {incident.status === "cerrado" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <NotificationDeadlineText deadline={deadline} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
