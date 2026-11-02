import { ERROR_CODES } from "../errors";
import type { FileIncidentStore, Incident } from "../incidents";
import type { RepairService } from "../repair";
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

/**
 * `repairActive`: la reparación asistida está activa (hay clave); entonces se avisa de que puede llegar una
 * propuesta en otro mensaje. Sin ella el texto es el de siempre.
 */
export function incidentMessage(incident: Incident, options: { repairActive?: boolean } = {}): string {
  const lines = [
    `Incidente #${incident.id} en ${incident.portal} (${STEP_LABELS[incident.step]}): ${incident.errorCode}.`,
    incident.reparable
      ? "Parece un cambio del portal. Guardé el detalle para diagnosticarlo."
      : nonRepairableHint(incident.errorCode),
  ];
  lines.push(
    incident.reparable
      ? options.repairActive && incident.structure
        ? `Estoy preparando una propuesta de reparación; si la hay, se la envío en otro mensaje. Mientras tanto, «sí ${incident.id}» o «no ${incident.id}» solo deja constancia de su decisión.`
        : `Aún no hay reparación automática: «sí ${incident.id}» o «no ${incident.id}» solo deja constancia de su decisión.`
      : `«no ${incident.id}» lo descarta cuando ya lo resolvió.`,
  );
  return lines.join("\n");
}

/** Decide qué hacer con lo que escribió el responsable. */
export function createIncomingHandler(control: BotControl, incidents?: FileIncidentStore, repair?: RepairService | null) {
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
      const lines = await Promise.all(
        open.map(async (i) => {
          const base = `#${i.id} ${i.portal} · ${STEP_LABELS[i.step]} · ${i.errorCode} · ${when(i.lastSeenAt)}${i.occurrences > 1 ? ` (${i.occurrences} veces)` : ""}`;
          const p = repair ? await repair.get(i.id).catch(() => null) : null;
          if (!p || p.estado !== "propuesta") return base;
          const label = p.probada ? "propuesta PROBADA" : p.ensayo.resultado === "no_cubierto" ? "propuesta SIN PROBAR" : "sin solución probada";
          return `${base} · ${label}`;
        }),
      );
      return lines.join("\n");
    }

    // Con una propuesta pendiente de un incidente abierto, «sí» la aplica y «no» la rechaza. Sin propuesta, todo igual que siempre.
    const proposal = repair ? await repair.pending(incoming.id) : null;
    if (repair && proposal && (await incidents.get(incoming.id))?.status === "abierto") {
      if (incoming.decision === "aprobado") {
        const applied = await repair.apply(incoming.id);
        if (!applied.ok) return `No pude aplicar la propuesta del incidente #${incoming.id}: ${applied.motivo}. El incidente sigue abierto.`;
        await incidents.decide(incoming.id, "aprobado");
        return `Incidente #${incoming.id} marcado como aprobado. Apliqué «${applied.propuesta.selector}» como ${applied.propuesta.clave} en ${applied.propuesta.portal}. La comprobación automática del portal la verificará; si falla dentro de ${repair.verifyMinutes} min, se revierte sola y se lo aviso.`;
      }
      await repair.reject(incoming.id);
      await incidents.decide(incoming.id, "rechazado");
      return `Incidente #${incoming.id} marcado como rechazado. Descarté la propuesta de reparación.`;
    }

    const result = await incidents.decide(incoming.id, incoming.decision);
    if (result === "no_existe") return `No existe el incidente #${incoming.id}. Envíe «incidentes» para ver los abiertos.`;
    if (result === "ya_decidido") return `El incidente #${incoming.id} ya estaba decidido.`;
    return `Incidente #${incoming.id} marcado como ${result.status}. Todavía no hay reparación automática: queda solo como constancia.`;
  };
}
