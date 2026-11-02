import { ejemploFicticio } from "./ejemplo-ficticio";
import type { PortalTemplate } from "./types";

export type { ExtractedApplicant, PortalTemplate } from "./types";

/**
 * Plantillas de producción: VACÍO A PROPÓSITO. Todavía no se verificó con un correo
 * real el formato de ningún portal (LinkedIn, Indeed, Bumeran, Computrabajo, Trabajos
 * Diarios), y no se inventa. Cada plantilla se escribe partiendo de un correo de aviso
 * REAL (reenviado como .eml a `muestras-correo/`) y se añade aquí.
 */
const PRODUCTION_TEMPLATES: readonly PortalTemplate[] = [];

export function getTemplates(enableExample: boolean): readonly PortalTemplate[] {
  return enableExample ? [...PRODUCTION_TEMPLATES, ejemploFicticio] : PRODUCTION_TEMPLATES;
}
