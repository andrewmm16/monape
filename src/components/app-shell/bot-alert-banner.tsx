import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { PORTAL_ERROR_LABELS } from "@/lib/labels";
import { BOT_SILENCE_MINUTES, type BotAlert } from "@/modules/portals/queries";

/** Causas que una persona resuelve iniciando sesión; las demás (el portal cambió) requieren corregir el adaptador. */
const SESSION_REASONS = new Set(["sesion_expirada", "verificacion_requerida"]);

/** Aviso a RRHH cuando el robot necesita a una persona o dejó de dar señales. */
export function BotAlertBanner({ alerts }: { alerts: BotAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <Alert key={`${alert.portalName}-${alert.kind}`} variant="destructive">
          <TriangleAlertIcon />
          {alert.kind === "necesita_persona" ? (
            <>
              <AlertTitle>El robot de {alert.portalName} necesita a una persona</AlertTitle>
              <AlertDescription>
                {(alert.reason && PORTAL_ERROR_LABELS[alert.reason]) ?? "El robot se detuvo."} (Se detuvo el{" "}
                {formatDateTime(alert.seenAt)}).{" "}
                {alert.reason === "navegador_cerrado"
                  ? "En la PC del robot, reinícielo (npm run bot) sin cerrar su ventana y vuelva a solicitar las publicaciones con error."
                  : SESSION_REASONS.has(alert.reason ?? "")
                  ? "En la PC del robot, inicie sesión de nuevo (npm run bot:login), reinícielo (npm run bot) y vuelva a solicitar las publicaciones con error."
                  :"Avise al responsable técnico: hay que revisar el adaptador del portal antes de reiniciar el robot (npm run bot). Mientras tanto, publique en ese portal a mano."}
              </AlertDescription>
            </>
          ) : (
            <>
              <AlertTitle>El robot de {alert.portalName} no responde</AlertTitle>
              <AlertDescription>
                No da señales desde hace más de {BOT_SILENCE_MINUTES} minutos (última: {formatDateTime(alert.seenAt)}).
                Revise que la PC del robot esté encendida y que el robot esté en ejecución (npm run bot).
              </AlertDescription>
            </>
          )}
        </Alert>
      ))}
    </div>
  );
}
