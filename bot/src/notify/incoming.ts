import { ERROR_CODES } from "../errors";
import type { FileIncidentStore, Incident } from "../incidents";
import type { Incoming } from "./commands";
import type { BotControl } from "./control";

const STEP_LABELS: Record<Incident["step"], string> = {
  publicar: "publicar",
  retirar: "retirar",
  leer_postulantes: "leer postulantes",
  descargar_cv: "descargar un CV",
  prueba_estructura: "prueba de estructura",
};

const when = (iso: string) => new Date(iso).toLocaleString("es-PE");

/** Aviso al responsable cuando aparece un incidente nuevo. */
function nonRepairableHint(code: string): string {
  if (code === ERROR_CODES.portalUnreachable) return "El portal no respondió (caído o sin conexión). No es un cambio de su página: no hay nada que reparar.";
  if (code === ERROR_CODES.appUnavailable || code === ERROR_CODES.resultRejected) return "El fallo fue con la app, no con el portal. Revise que la app responda.";
  return "Lo resuelve una persona en la PC del robot (sesión o verificación).";
}

export function incidentMessage(incident: Incident): string {
  const lines = [
    `Incidente #${incident.id} en ${incident.portal} (${STEP_LABELS[incident.step]}): ${incident.errorCode}.`,
    incident.reparable
      ? "Parece un cambio del portal. Guardé el detalle para diagnosticarlo."
      : nonRepairableHint(incident.errorCode),
  ];
  lines.push(
    incident.reparable
      ? `Aún no hay reparación automática: «sí ${incident.id}» o «no ${incident.id}» solo deja constancia de su decisión.`
      : `«no ${incident.id}» lo descarta cuando ya lo resolvió.`,
  );
  return lines.join("\n");
}

/** Decide qué hacer con lo que escribió el responsable. */
export function createIncomingHandler(control: BotControl, incidents?: FileIncidentStore) {
  return async (incoming: Incoming): Promise<string> => {
    if (incoming.kind === "command") {
      const reply = control.handle(incoming.command);
      return incoming.command === "ayuda" && incidents
        ? `${reply}\nincidentes: lista los abiertos\nsí N / no N: decide el incidente N`
        : reply;
    }
    if (!incidents) return "Este robot no guarda incidentes.";

    if (incoming.kind === "incidents") {
      const open = (await incidents.list()).filter((incident) => incident.status === "abierto");
      if (open.length === 0) return "No hay incidentes abiertos.";
      return open
        .map(
          (i) =>
            `#${i.id} ${i.portal} · ${STEP_LABELS[i.step]} · ${i.errorCode} · ${when(i.lastSeenAt)}${i.occurrences > 1 ? ` (${i.occurrences} veces)` : ""}`,
        )
        .join("\n");
    }

    const result = await incidents.decide(incoming.id, incoming.decision);
    if (result === "no_existe") return `No existe el incidente #${incoming.id}. Envíe «incidentes» para ver los abiertos.`;
    if (result === "ya_decidido") return `El incidente #${incoming.id} ya estaba decidido.`;
    return `Incidente #${incoming.id} marcado como ${result.status}. Todavía no hay reparación automática: queda solo como constancia.`;
  };
}
