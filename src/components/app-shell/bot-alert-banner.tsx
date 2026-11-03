import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTime } from "@/lib/format";
import { PORTAL_ERROR_LABELS } from "@/lib/labels";
import { BOT_SILENCE_MINUTES, type BotAlert } from "@/modules/portals/queries";

/** Causas que una persona resuelve iniciando sesión; las demás (el portal cambió) requieren corregir el adaptador. */
const SESSION_REASONS = new Set(["sesion_expirada", "verificacion_requerida"]);

/** Junta los avisos iguales (mismo tipo y causa) para mostrar uno solo con la lista de portales. */
function groupAlerts(alerts: BotAlert[]) {
  const groups = new Map<string, { kind: BotAlert["kind"]; reason: BotAlert["reason"]; portals: string[]; seenAt: BotAlert["seenAt"] }>();
  for (const alert of alerts) {
    const key = `${alert.kind}|${alert.reason ?? ""}`;
    const group = groups.get(key);
    if (group) {
      group.portals.push(alert.portalName);
      if (alert.seenAt > group.seenAt) group.seenAt = alert.seenAt;
    } else {
      groups.set(key, { kind: alert.kind, reason: alert.reason, portals: [alert.portalName], seenAt: alert.seenAt });
    }
  }
  return [...groups.entries()];
}

/** Aviso a RRHH cuando el robot necesita a una persona o dejó de dar señales. Es un solo robot que atiende varios portales. */
export function BotAlertBanner({ alerts }: { alerts: BotAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {groupAlerts(alerts).map(([key, group]) => {
        const portals = group.portals.join(", ");
        return (
          <Alert key={key} variant="destructive">
            <TriangleAlertIcon />
            {group.kind === "necesita_persona" ? (
              <>
                <AlertTitle>El robot no puede trabajar en: {portals}</AlertTitle>
                <AlertDescription>
                  {(group.reason && PORTAL_ERROR_LABELS[group.reason]) ?? "El robot se detuvo."} (Desde el{" "}
                  {formatDateTime(group.seenAt)}).{" "}
                  {group.reason === "navegador_cerrado"
                    ? "En la PC del robot, reinícielo (npm run bot) sin cerrar su ventana y vuelva a solicitar las publicaciones con error."
                    : SESSION_REASONS.has(group.reason ?? "")
                    ? "En la PC del robot, inicie sesión de nuevo (npm run bot:login), reinícielo (npm run bot) y vuelva a solicitar las publicaciones con error."
                    : group.reason === "portal_no_disponible"
                    ? "El robot lo vuelve a intentar solo cada pocos minutos. Mientras tanto, publique en esos portales a mano."
                    : "Avise al responsable técnico: hay que revisar el adaptador del portal antes de reiniciar el robot (npm run bot). Mientras tanto, publique en esos portales a mano."}
                </AlertDescription>
              </>
            ) : (
              <>
                <AlertTitle>El robot no responde en: {portals}</AlertTitle>
                <AlertDescription>
                  No da señales desde hace más de {BOT_SILENCE_MINUTES} minutos (última: {formatDateTime(group.seenAt)}).
                  Revise que la PC del robot esté encendida y que el robot esté en ejecución (npm run bot).
                </AlertDescription>
              </>
            )}
          </Alert>
        );
      })}
    </div>
  );
}
