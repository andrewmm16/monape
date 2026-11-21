import { z } from "zod";
import { Constants } from "@/types/database";
import { limaToIso } from "./datetime";
import { optionalText, refineInterviewDetails } from "./schemas";

/**
 * Autoagenda (opción A): RRHH ofrece de 1 a 6 horarios y la persona candidata
 * elige uno desde su enlace. Validación compartida entre el diálogo y el servidor.
 */

export const MAX_BOOKING_SLOTS = 6;
/** Plazo por defecto para elegir: estas horas antes del primer horario. */
export const DEFAULT_DEADLINE_HOURS_BEFORE = 2;

const slotSchema = z.object({
  date: z.string().min(1, "Indique la fecha"),
  time: z.string().min(1, "Indique la hora"),
});

export const bookingFormSchema = z
  .object({
    slots: z.array(slotSchema).min(1, "Ofrezca al menos un horario").max(MAX_BOOKING_SLOTS, `Ofrezca hasta ${MAX_BOOKING_SLOTS} horarios`),
    durationMinutes: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, "Indique la duración en minutos")
      .refine((v) => Number(v) >= 15 && Number(v) <= 480, "La duración debe estar entre 15 y 480 minutos"),
    modality: z.enum(Constants.public.Enums.interview_modality, { error: "Seleccione la modalidad" }),
    location: optionalText(500),
    interviewers: optionalText(300),
    interviewerEmails: z.string().trim().max(2600, "Demasiado texto").default(""),
    instructions: optionalText(2000),
    /** Hasta cuándo puede elegir (opcional; vacío = 2 horas antes del primer horario). */
    deadlineDate: z.string().trim().default(""),
    deadlineTime: z.string().trim().default(""),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.slots.forEach((slot, index) => {
      const iso = limaToIso(slot.date, slot.time);
      if (iso === null) {
        ctx.addIssue({ code: "custom", message: "La fecha o la hora no son válidas", path: ["slots", index, "date"] });
      } else if (seen.has(iso)) {
        ctx.addIssue({ code: "custom", message: "Este horario está repetido", path: ["slots", index, "time"] });
      } else {
        seen.add(iso);
      }
    });
    if ((v.deadlineDate === "") !== (v.deadlineTime === "")) {
      ctx.addIssue({ code: "custom", message: "Indique la fecha y la hora del plazo, o deje ambas vacías", path: ["deadlineDate"] });
    } else if (v.deadlineDate !== "" && limaToIso(v.deadlineDate, v.deadlineTime) === null) {
      ctx.addIssue({ code: "custom", message: "La fecha o la hora del plazo no son válidas", path: ["deadlineDate"] });
    }
    refineInterviewDetails(v, ctx);
  });

export type BookingFormValues = z.input<typeof bookingFormSchema>;

export const inviteToBookSchema = z.object({ applicationId: z.uuid() }).and(bookingFormSchema);
export type InviteToBookInput = z.input<typeof inviteToBookSchema>;

/**
 * Plazo para elegir: el indicado, o 2 horas antes del primer horario. Si eso deja
 * menos de media hora desde ahora (primer horario cercano), 30 minutos antes de él.
 */
export function bookingDeadlineIso(slotsIso: string[], deadlineIso: string | null, now: number = Date.now()): string {
  if (deadlineIso) return deadlineIso;
  const first = Math.min(...slotsIso.map((iso) => Date.parse(iso)));
  const usual = first - DEFAULT_DEADLINE_HOURS_BEFORE * 3_600_000;
  return new Date(usual > now + 30 * 60_000 ? usual : first - 30 * 60_000).toISOString();
}

/** Mensajes de la página pública (la persona candidata): tutean, como el resto de la página. */
export const BOOKING_PUBLIC_MESSAGES = {
  unavailable: "Ese horario ya no está disponible. Recarga la página y elige otro.",
  closed: "Esta invitación ya no está disponible. Si necesitas otro horario, escribe a Recursos Humanos.",
  rateLimited: "Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
  generic: "No se pudo agendar la entrevista. Inténtalo de nuevo en unos minutos.",
} as const;

/**
 * Qué mostrar en la tarjeta «Entrevistas»: «pendiente» si aún puede elegir;
 * «vencida» si se le pasó el plazo y no hay entrevista programada; si no, nada
 * (la eligió, o RRHH la canceló o programó a mano).
 */
export function bookingStateOf(
  booking: { status: "pendiente" | "agendada" | "vencida" | "cancelada"; expiresAt: string; createdAt: string },
  interviews: { programmed: boolean; latestInterviewCreatedAt: string | null },
  now: number = Date.now(),
): "pendiente" | "vencida" | null {
  if (booking.status === "pendiente" && Date.parse(booking.expiresAt) > now) return "pendiente";
  // Después de la invitación hubo una entrevista (programada a mano, ya realizada o cancelada): el aviso ya no aplica.
  const interviewSince =
    interviews.latestInterviewCreatedAt !== null && Date.parse(interviews.latestInterviewCreatedAt) > Date.parse(booking.createdAt);
  if ((booking.status === "vencida" || booking.status === "pendiente") && !interviews.programmed && !interviewSince) return "vencida";
  return null;
}
