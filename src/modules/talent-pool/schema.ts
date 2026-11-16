import { z } from "zod";

export const TALENT_SOURCES = ["manual", "bolsa_empleo", "linkedin", "referido", "web_empresa", "otro"] as const;
export const TALENT_APPLICATION_STATUSES = [
  "nuevo",
  "en_revision",
  "preseleccionado",
  "entrevista_programada",
  "en_evaluacion",
  "seleccionado",
  "no_seleccionado",
  "en_reserva",
  "retirado",
] as const;

/** Filtros del buscador de talento (query params). Valores inválidos se descartan. */
export const talentFiltersSchema = z.object({
  /** Texto libre: nombre o texto del CV. */
  q: z.string().trim().max(100).catch(""),
  /** Habilidades/herramientas separadas por coma; el candidato debe tenerlas todas. */
  skills: z.string().trim().max(200).catch(""),
  source: z.enum(TALENT_SOURCES).optional().catch(undefined),
  location: z.string().trim().max(100).catch(""),
  /** Estado de alguna postulación previa del candidato. */
  status: z.enum(TALENT_APPLICATION_STATUSES).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

export type TalentFilters = z.infer<typeof talentFiltersSchema>;
