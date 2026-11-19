import { z } from "zod";
import { APPLICATION_STATUS_LABELS, CANDIDATE_SOURCE_LABELS } from "@/lib/labels";
import type { BotPortalStatus } from "@/modules/portals/queries";
import { estadoGeneralRobot } from "@/modules/portals/estado-ui";
import type { Enums } from "@/types/database";

/**
 * Detalle que se abre al hacer clic en una etapa, una fuente o un portal. Viaja
 * por la URL (`?detalle=etapa:en_revision`), así que todo valor se valida.
 */
export type ReportDetail =
  | { kind: "etapa"; value: Enums<"application_status"> }
  | { kind: "fuente"; value: Enums<"candidate_source"> }
  | { kind: "portal"; value: string };

/** Máximo de filas del detalle. */
export const DETAIL_LIMIT = 50;

const PORTAL_MAX = 80;

function parseDetail(raw: string): ReportDetail | undefined {
  const sep = raw.indexOf(":");
  if (sep < 1) return undefined;
  const kind = raw.slice(0, sep);
  const value = raw.slice(sep + 1);
  if (kind === "etapa" && Object.hasOwn(APPLICATION_STATUS_LABELS, value)) {
    return { kind, value: value as Enums<"application_status"> };
  }
  if (kind === "fuente" && Object.hasOwn(CANDIDATE_SOURCE_LABELS, value)) {
    return { kind, value: value as Enums<"candidate_source"> };
  }
  if (kind === "portal" && value.length > 0 && value.length <= PORTAL_MAX && !/[\u0000-\u001f]/.test(value)) {
    return { kind, value };
  }
  return undefined;
}

/** `detalle` de la URL: un valor desconocido, repetido o mal formado se ignora sin error. */
export const detailParamSchema = z
  .string()
  .max(PORTAL_MAX + 10)
  .transform(parseDetail)
  .optional()
  .catch(undefined);

export function parseDetailParam(raw: unknown): ReportDetail | undefined {
  return detailParamSchema.parse(raw) ?? undefined;
}

export function detailKey(detail: ReportDetail): string {
  return `${detail.kind}:${detail.value}`;
}

export function isSameDetail(a: ReportDetail | undefined, b: ReportDetail | undefined): boolean {
  return Boolean(a && b && detailKey(a) === detailKey(b));
}

/**
 * Enlace a `/reportes` conservando los filtros actuales. Con `detail` abre el
 * detalle (y baja al ancla `#detalle`); sin él lo cierra.
 */
export function buildReportHref(
  filters: { vacante?: string; desde?: string; hasta?: string },
  detail?: ReportDetail,
): string {
  const query = new URLSearchParams();
  if (filters.vacante) query.set("vacante", filters.vacante);
  if (filters.desde) query.set("desde", filters.desde);
  if (filters.hasta) query.set("hasta", filters.hasta);
  if (detail) query.set("detalle", detailKey(detail));
  const qs = query.toString();
  return `/reportes${qs ? `?${qs}` : ""}${detail ? "#detalle" : ""}`;
}

export type PortalRobotLabel = { estado: "encendido" | "reparacion" | "sin_senal"; label: string };

const ROBOT_LABELS: Record<PortalRobotLabel["estado"], string> = {
  encendido: "Encendido",
  reparacion: "En reparación",
  sin_senal: "Sin señal",
};

/** Estado del robot en un portal, en las tres palabras que entiende RRHH. `null` si el robot no atiende ese portal. */
export function portalRobotLabel(status: BotPortalStatus | undefined): PortalRobotLabel | null {
  if (!status) return null;
  const { estado } = estadoGeneralRobot([status]);
  const key = estado === "encendido" ? "encendido" : estado === "reparacion" ? "reparacion" : "sin_senal";
  return { estado: key, label: ROBOT_LABELS[key] };
}
