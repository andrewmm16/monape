import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { BotDailySummary } from "@/modules/portals/daily-summary";
import { estadoUi, type Tono } from "@/modules/portals/estado-ui";
import { resumenDiarioLinea } from "@/modules/portals/estado-ui";
import type { BotPortalStatus } from "@/modules/portals/queries";

/** Color del punto de cada portal; usa los tokens del tema (claro/oscuro). */
const TONO_PUNTO: Record<Tono, string> = {
  verde: "bg-success-foreground",
  amarillo: "bg-warning-foreground",
  rojo: "bg-destructive",
  gris: "bg-muted-foreground/40",
};

/**
 * Semáforo del robot para RRHH: una frase con lo que hizo hoy y, debajo, cada
 * portal con un punto de color y una frase sin jerga. Solo informa; el aviso
 * rojo con los pasos a seguir sigue siendo el banner de arriba.
 */
export function BotStatusPanel({ statuses, daily }: { statuses: BotPortalStatus[]; daily: BotDailySummary }) {
  if (statuses.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estado del robot</CardTitle>
        <CardDescription>{resumenDiarioLinea(daily, statuses)}</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
