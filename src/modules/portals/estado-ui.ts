import type { BotDailySummary } from "./daily-summary";
import type { BotPortalStatus } from "./queries";

/** Color del punto del semáforo. */
export type Tono = "verde" | "amarillo" | "rojo" | "gris";

/** Punto de color y frase sin jerga para un portal en el semáforo. */
export function estadoUi(status: BotPortalStatus): { tono: Tono; etiqueta: string } {
  switch (status.nivel) {
    case "ok":
      return { tono: "verde", etiqueta: "Trabajando bien" };
    case "sin_datos":
      return { tono: "gris", etiqueta: "Aún no se ha conectado" };
    case "error":
      return { tono: "rojo", etiqueta: "Necesita al técnico (el portal cambió)" };
    case "atencion":
      return { tono: "amarillo", etiqueta: etiquetaAtencion(status.reason) };
  }
}

function etiquetaAtencion(reason: string | null): string {
  switch (reason) {
    case "sin_senal":
      return "Sin señal (¿la PC está encendida?)";
    case "sesion_expirada":
    case "verificacion_requerida":
      return "Necesita que inicies sesión";
    case "navegador_cerrado":
      return "Hay que reiniciar el robot";
    case "portal_no_disponible":
      return "El portal no responde; el robot reintenta solo";
    default:
      return "Necesita tu atención";
  }
}

/** La frase de una línea del resumen del día, para el panel y para WhatsApp. */
export function resumenDiarioLinea(daily: BotDailySummary, statuses: BotPortalStatus[]): string {
  const conectados = statuses.filter((s) => s.nivel !== "sin_datos");
  if (conectados.length === 0) return "Hoy el robot aún no se ha conectado a ningún portal.";

  const { publishedToday: pub, applicantsToday: app } = daily;
  const actividad =
    pub === 0 && app === 0
      ? "Hoy el robot no publicó nada nuevo ni llegaron postulantes."
      : `Hoy: ${pub} ${pub === 1 ? "vacante" : "vacantes"} publicada${pub === 1 ? "" : "s"} y ${app} ${
          app === 1 ? "postulante" : "postulantes"
        } recibido${app === 1 ? "" : "s"}.`;

  const necesitan = conectados.filter((s) => s.nivel === "atencion" || s.nivel === "error").length;
  const estado =
    necesitan === 0
      ? " ✅ Todos los portales están bien."
      : ` ⚠️ ${necesitan} ${necesitan === 1 ? "portal necesita" : "portales necesitan"} tu atención.`;

  return actividad + estado;
}
