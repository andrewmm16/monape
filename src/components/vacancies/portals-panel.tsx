import { PortalPicker } from "@/components/vacancies/portal-picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { portalLogo } from "@/modules/portals/logos";
import type { PortalPublicationRow } from "@/modules/portals/queries";
import type { Enums } from "@/types/database";

/**
 * Publicación de la vacante en portales de empleo mediante el robot. RRHH elige
 * los portales y consulta el estado; el robot publica y trae a los postulantes.
 */
export function PortalsPanel({
  vacancyId,
  vacancyStatus,
  rows,
  botEnabled,
}: {
  vacancyId: string;
  vacancyStatus: Enums<"vacancy_status">;
  rows: PortalPublicationRow[];
  botEnabled: boolean;
}) {
  return (
    <div className="space-y-4">
      {!botEnabled ? (
        <Alert>
          <AlertTitle>Robot de portales apagado</AlertTitle>
          <AlertDescription>
            Este servidor no tiene configurado el robot (PORTAL_BOT_SECRET). Las solicitudes quedan en cola hasta que
            un robot conectado las procese.
          </AlertDescription>
        </Alert>
      ) : null}
      {vacancyStatus !== "publicada" ? (
        <Alert>
          <AlertTitle>La vacante debe estar publicada</AlertTitle>
          <AlertDescription>Publíquela para poder enviarla a los portales.</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Marque los portales donde debe estar la vacante y desmarque los que quiera retirar; los cambios se aplican con «Guardar cambios». Los que dicen «Robot aún no disponible» se publican a mano por ahora.
      </p>
      {/* La clave reinicia la selección cuando el robot cambia el estado de algún portal. */}
      <PortalPicker
        key={rows.map((row) => row.publication?.status ?? "-").join()}
        vacancyId={vacancyId}
        canPublish={vacancyStatus === "publicada"}
        rows={rows.map((row) => ({ ...row, logo: portalLogo(row.portal.name) }))}
      />
    </div>
  );
}
