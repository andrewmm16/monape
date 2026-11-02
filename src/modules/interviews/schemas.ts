import { z } from "zod";
import { Constants, type Enums } from "@/types/database";
import { limaToIso } from "./datetime";

/** Estados que cierran la postulación: no admiten entrevistas nuevas ni cambian por una entrevista. */
export const CLOSED_STATUSES = ["seleccionado", "no_seleccionado", "retirado"] as const;

/** Estados de la vista «Descartados» de la vacante. */
export const DISCARDED_STATUSES = ["no_seleccionado", "retirado"] as const;

/** ¿Se puede programar una entrevista? (mismas reglas que schedule_interview) */
export function canScheduleInterview(
  status: Enums<"application_status">,
  vacancyStatus: Enums<"vacancy_status">,
): boolean {
  return vacancyStatus !== "archivada" && !(CLOSED_STATUSES as readonly string[]).includes(status);
}

const optionalText = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);

/** Datos del formulario de agendar o reprogramar (fecha y hora en hora de Perú). */
export const interviewFormSchema = z
  .object({
    date: z.string().min(1, "Indique la fecha"),
    time: z.string().min(1, "Indique la hora"),
    durationMinutes: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, "Indique la duración en minutos")
      .refine((v) => Number(v) >= 15 && Number(v) <= 480, "La duración debe estar entre 15 y 480 minutos"),
    modality: z.enum(Constants.public.Enums.interview_modality, { error: "Seleccione la modalidad" }),
    location: optionalText(500),
    interviewers: optionalText(300),
    instructions: optionalText(2000),
  })
  .refine((v) => limaToIso(v.date, v.time) !== null, { message: "La fecha o la hora no son válidas", path: ["date"] });

export type InterviewFormValues = z.input<typeof interviewFormSchema>;

export const scheduleInterviewSchema = z.object({ applicationId: z.uuid() }).and(interviewFormSchema);
export const rescheduleInterviewSchema = z.object({ interviewId: z.uuid() }).and(interviewFormSchema);

export type ScheduleInterviewInput = z.input<typeof scheduleInterviewSchema>;
export type RescheduleInterviewInput = z.input<typeof rescheduleInterviewSchema>;

export const cancelInterviewSchema = z.object({
  interviewId: z.uuid(),
  reason: z.string().trim().min(3, "Escriba el motivo (al menos 3 caracteres)").max(500, "Máximo 500 caracteres"),
});

export type CancelInterviewInput = z.input<typeof cancelInterviewSchema>;

export const INTERVIEW_OUTCOMES = ["paso", "no_paso", "no_asistio"] as const;
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];

const notesSchema = z.string().trim().max(4000, "Máximo 4000 caracteres");

const checkedNoteSchema = z
  .string()
  .trim()
  .max(1000, "Máximo 1000 caracteres")
  .refine((v) => v.length === 0 || v.length >= 3, "La nota debe tener al menos 3 caracteres");

export const interviewVerificationSchema = z.object({
  requirementId: z.uuid(),
  result: z.enum(["acreditado", "no_cumplido"], { error: "Seleccione el resultado" }),
  note: checkedNoteSchema,
});

export const recordResultSchema = z
  .object({
    interviewId: z.uuid(),
    outcome: z.enum(INTERVIEW_OUTCOMES, { error: "Seleccione el resultado de la entrevista" }),
    notes: notesSchema,
    verifications: z.array(interviewVerificationSchema).max(30, "Máximo 30 requisitos"),
  })
  .refine((v) => v.outcome !== "no_paso" || v.notes.length >= 3, {
    message: "Indique el motivo (al menos 3 caracteres)",
    path: ["notes"],
  });

export type RecordResultInput = z.input<typeof recordResultSchema>;

/** Estado del requisito en el formulario: «Sin cambios», «Cumple» o «No cumple». */
export const CHECK_CHOICES = ["", "acreditado", "no_cumplido"] as const;

/** Formulario del diálogo «Registrar resultado»: un renglón por requisito vigente. */
export const recordResultFormSchema = z
  .object({
    outcome: z.enum(INTERVIEW_OUTCOMES, { error: "Seleccione el resultado de la entrevista" }),
    notes: notesSchema,
    checks: z.array(
      z.object({
        requirementId: z.uuid(),
        choice: z.enum(CHECK_CHOICES),
        note: checkedNoteSchema,
      }),
    ),
  })
  .refine((v) => v.outcome !== "no_paso" || v.notes.length >= 3, {
    message: "Indique el motivo (al menos 3 caracteres)",
    path: ["notes"],
  });

export type RecordResultFormValues = z.input<typeof recordResultFormSchema>;

/** Filtros de /entrevistas (en la URL). */
export const interviewListParamsSchema = z.object({
  vacante: z.uuid().or(z.literal("")).catch(""),
});

/** Requisito vigente que se muestra en el diálogo del resultado. */
export type InterviewRequirement = {
  id: string;
  description: string;
  priority: Enums<"requirement_priority">;
  /** Valoración actual (última evaluación); null si no hay evaluación. */
  assessment: Enums<"requirement_assessment"> | null;
  /** La valoración actual viene de una verificación de RRHH. */
  verified: boolean;
};
