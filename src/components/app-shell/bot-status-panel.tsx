import { ChevronDownIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { BotDailySummary } from "@/modules/portals/daily-summary";
import { estadoUi, type Tono } from "@/modules/portals/estado-ui";
import { resumenActividadHoy, resumenDiarioLinea } from "@/modules/portals/estado-ui";
import type { BotPortalStatus } from "@/modules/portals/queries";

/** Color del punto de cada portal; usa los tokens del tema (claro/oscuro). */
const TONO_PUNTO: Record<Tono, string> = {
  verde: "bg-success-foreground",
  amarillo: "bg-warning-foreground",
  rojo: "bg-destructive",
  gris: "bg-muted-foreground/40",
};

function PortalList({ statuses }: { statuses: BotPortalStatus[] }) {
  return (
    <ul className="divide-y text-sm">
      {statuses.map((status) => {
        const ui = estadoUi(status);
        return (
          <li key={status.portalName} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
            <span className={`size-2.5 shrink-0 rounded-full ${TONO_PUNTO[ui.tono]}`} aria-hidden />
            <span className="font-medium">{status.portalName}</span>
            <span className="text-muted-foreground">— {ui.etiqueta}</span>
            {status.seenAt ? (
              <span className="ml-auto text-xs text-muted-foreground">Última señal: {formatDateTime(status.seenAt)}</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Semáforo del robot para RRHH: una frase con lo que hizo hoy y cada portal con
 * un punto de color y una frase sin jerga. Si todos van bien se resume en una
 * línea (el detalle queda plegado) para no ocupar el inicio del panel; si alguno
 * falla, la lista se muestra abierta. Solo informa; el aviso rojo con los pasos
 * a seguir sigue siendo el banner de arriba.
 */
export function BotStatusPanel({ statuses, daily }: { statuses: BotPortalStatus[]; daily: BotDailySummary }) {
  if (statuses.length === 0) return null;
  const allGood = statuses.every((status) => estadoUi(status).tono === "verde");
  if (allGood) {
    return (
      <Card data-testid="bot-status" className="py-3">
        <CardContent>
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm [&::-webkit-details-marker]:hidden">
              <span className={`size-2.5 shrink-0 rounded-full ${TONO_PUNTO.verde}`} aria-hidden />
              <span className="font-medium">
                El robot funciona bien en {statuses.length === 1 ? "el portal" : `los ${statuses.length} portales`}
              </span>
              <span className="text-muted-foreground">· {resumenActividadHoy(daily)}</span>
              <span className="ml-auto inline-flex items-center gap-1 text-brand">
                <span className="group-open:hidden">Ver detalle</span>
                <span className="hidden group-open:inline">Ocultar detalle</span>
                <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="pt-2">
              <PortalList statuses={statuses} />
            </div>
          </details>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="bot-status">
      <CardHeader>
        <CardTitle>Estado del robot</CardTitle>
        <CardDescription>{resumenDiarioLinea(daily, statuses)}</CardDescription>
      </CardHeader>
      <CardContent>
        <PortalList statuses={statuses} />
      </CardContent>
    </Card>
  );
}
