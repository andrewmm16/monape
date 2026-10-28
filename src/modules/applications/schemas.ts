import { z } from "zod";
import { Constants, type Enums } from "@/types/database";

export const applicationStatusSchema = z.enum(Constants.public.Enums.application_status, {
  error: "Seleccione el nuevo estado",
});

/** Estados que exigen motivo (también lo verifica la base de datos). */
export const STATUSES_REQUIRING_REASON = ["no_seleccionado", "retirado"] as const;

/**
 * Estados en proceso: un candidato solo puede tener una postulación así, salvo
 * en vacantes archivadas (mismas reglas que private.is_application_in_process).
 */
export const IN_PROCESS_STATUSES = [
  "nuevo",
  "en_revision",
  "preseleccionado",
  "entrevista_programada",
  "en_evaluacion",
] as const satisfies readonly Enums<"application_status">[];

export function isInProcess(application: {
  status: Enums<"application_status"> | null;
  vacancy_status: Enums<"vacancy_status"> | null;
}): boolean {
  return (
    application.vacancy_status !== "archivada" &&
    (IN_PROCESS_STATUSES as readonly (string | null)[]).includes(application.status)
  );
}

export const changeStatusSchema = z
  .object({
    applicationId: z.uuid(),
    status: applicationStatusSchema,
    reason: z.string().trim().max(500, "Máximo 500 caracteres"),
    note: z.string().trim().max(4000, "Máximo 4000 caracteres"),
  })
  .refine(
    (v) => !(STATUSES_REQUIRING_REASON as readonly string[]).includes(v.status) || v.reason.length > 0,
    { message: "Indique el motivo", path: ["reason"] },
  );

export type ChangeStatusInput = z.input<typeof changeStatusSchema>;

export const noteSchema = z.object({
  applicationId: z.uuid(),
  note: z.string().trim().min(1, "Escriba la observación").max(4000, "Máximo 4000 caracteres"),
});

export const reviewSchema = z
  .object({
    evaluationId: z.uuid(),
    outcome: z.enum(Constants.public.Enums.evaluation_review_outcome),
    notes: z.string().trim().max(4000, "Máximo 4000 caracteres"),
  })
  .refine((v) => v.outcome === "conforme" || v.notes.length > 0, {
    message: "Registre las observaciones de la revisión",
    path: ["notes"],
  });

export type ReviewInput = z.input<typeof reviewSchema>;

/** Parámetros del listado de candidatos por vacante (en la URL). */
export const applicationListParamsSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  status: applicationStatusSchema.or(z.literal("")).catch(""),
  level: z.enum([...Constants.public.Enums.compatibility_level, "sin_evaluar"]).or(z.literal("")).catch(""),
  sort: z.enum(["puntuacion", "fecha", "nombre"]).catch("puntuacion"),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

export type ApplicationListParams = z.infer<typeof applicationListParamsSchema>;
