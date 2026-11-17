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
  /** Etiqueta (id) para filtrar el pool. */
  tag: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

export type TalentFilters = z.infer<typeof talentFiltersSchema>;

/** Colores disponibles para una etiqueta (coinciden con el check de la BD). */
export const TALENT_TAG_COLORS = ["slate", "green", "blue", "amber", "red", "orange"] as const;
export type TalentTagColor = (typeof TALENT_TAG_COLORS)[number];

export const createTalentTagSchema = z.object({
  name: z.string().trim().min(1, "Escribe un nombre").max(40, "Máximo 40 caracteres"),
  color: z.enum(TALENT_TAG_COLORS).optional(),
});
export type CreateTalentTagInput = z.input<typeof createTalentTagSchema>;

export const candidateTagSchema = z.object({
  candidateId: z.uuid(),
  tagId: z.uuid(),
});
export type CandidateTagInput = z.input<typeof candidateTagSchema>;

export const reactivateCandidateSchema = z.object({
  candidateId: z.uuid(),
  vacancyId: z.uuid(),
});
export type ReactivateCandidateInput = z.input<typeof reactivateCandidateSchema>;

/** Acción en lote (invitar o añadir) sobre varios candidatos sugeridos de una vacante. */
export const batchCandidateVacancySchema = z.object({
  vacancyId: z.uuid(),
  candidateIds: z.array(z.uuid()).min(1, "Selecciona al menos un candidato").max(100, "Máximo 100 a la vez"),
});
export type BatchCandidateVacancyInput = z.input<typeof batchCandidateVacancySchema>;
