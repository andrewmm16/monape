import type { Enums } from "@/types/database";

/**
 * Estados que se pueden comunicar a la persona candidata (tienen plantilla de
 * correo). Los demás (nuevo, en_revision, en_evaluacion, en_reserva, retirado)
 * son internos o no tienen sentido para quien postula: no envían correo aunque
 * RRHH marque «Avisar al candidato». Módulo sin dependencias de servidor para
 * poder usarlo también en el formulario.
 */
export const COMMUNICABLE_STATUSES = [
  "entrevista_programada",
  "seleccionado",
  "no_seleccionado",
] as const satisfies readonly Enums<"application_status">[];

export function isCommunicableStatus(status: string): boolean {
  return (COMMUNICABLE_STATUSES as readonly string[]).includes(status);
}
