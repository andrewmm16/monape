import { ChevronDownIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { BotDailySummary } from "@/modules/portals/daily-summary";
import { estadoGeneralRobot, estadoUi, resumenActividadHoy, type EstadoRobot, type Tono } from "@/modules/portals/estado-ui";
import type { BotPortalStatus } from "@/modules/portals/queries";

/** Color del punto de cada portal; usa los tokens del tema (claro/oscuro). */
const TONO_PUNTO: Record<Tono, string> = {
  verde: "bg-success-foreground",
  amarillo: "bg-warning-foreground",
  rojo: "bg-destructive",
  gris: "bg-muted-foreground/40",
};

/** Lo que ve quien usa la app: si el robot funciona, sin detalles técnicos. */
const ESTADO: Record<Exclude<EstadoRobot, "sin_datos">, { tono: Tono; titulo: string; caja: string }> = {
  encendido: { tono: "verde", titulo: "Robot encendido", caja: "" },
  reparacion: {
    tono: "amarillo",
    titulo: "Robot en reparación",
    caja: "border-warning-foreground/40 bg-warning text-warning-foreground",
  },
  apagado: { tono: "rojo", titulo: "Robot apagado", caja: "border-destructive/40 bg-destructive/5" },
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
 * Estado del robot en el Panel. Para todo el personal, una línea simple:
 * encendido, en reparación (con los portales afectados) o apagado. Quien
 * administra (`detail`) puede desplegar el detalle técnico por portal; el aviso
 * con los pasos para arreglarlo es el banner de arriba, también solo para
 * administración.
 */
export function BotStatusPanel({
  statuses,
  daily,
  detail = false,
}: {
  statuses: BotPortalStatus[];
  daily: BotDailySummary;
  /** Mostrar el detalle técnico por portal (solo administración). */
  detail?: boolean;
}) {
  if (statuses.length === 0) return null;
  const { estado, portalesEnReparacion } = estadoGeneralRobot(statuses);
  // Sin datos: el robot nunca se conectó. Solo lo ve administración.
  if (estado === "sin_datos") {
    return detail ? (
      <Card data-testid="bot-status" className="py-3">
        <CardContent className="flex items-center gap-2 text-sm">
          <span className={`size-2.5 shrink-0 rounded-full ${TONO_PUNTO.gris}`} aria-hidden />
          El robot de portales aún no se ha conectado.
        </CardContent>
      </Card>
    ) : null;
  }
  const ui = ESTADO[estado];
  const mensaje =
    estado === "encendido"
      ? `Publica las vacantes y trae postulantes de los portales con normalidad. ${resumenActividadHoy(daily)}`
      : estado === "reparacion"
        ? `Falla en ${portalesEnReparacion.join(", ")}. Ya estamos trabajando en ello; los demás portales siguen funcionando.`
        : "Por ahora no publica vacantes ni trae postulantes de los portales. Ya estamos al tanto.";
  const resumen = (
    <>
      <span className={`size-2.5 shrink-0 rounded-full ${TONO_PUNTO[ui.tono]}`} aria-hidden />
      <span className="font-medium">{ui.titulo}</span>
      <span className="hidden sm:inline" aria-hidden>
        ·
      </span>
      <span className={estado === "encendido" ? "text-muted-foreground" : ""}>{mensaje}</span>
    </>
  );
  return (
    <Card data-testid="bot-status" data-estado={estado} role="status" className={`py-3 ${ui.caja}`}>
      <CardContent>
        {detail ? (
          // Administración: el detalle por portal, abierto si algo falla.
          <details className="group" open={estado !== "encendido"}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm [&::-webkit-details-marker]:hidden">
              {resumen}
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
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">{resumen}</p>
        )}
      </CardContent>
    </Card>
  );
}
