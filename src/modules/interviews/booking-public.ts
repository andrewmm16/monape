import "server-only";
import { z } from "zod";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Constants } from "@/types/database";
import { hashBookingToken, isBookingTokenShape } from "./booking-token";

/**
 * Lo que ve la persona candidata en /agendar/<token>: puesto, modalidad,
 * duración, lugar y los horarios disponibles. Nunca datos de otras personas.
 * Se lee con el cliente de servicio (la página no tiene sesión).
 */
const publicBookingSchema = z.object({
  status: z.enum(["pendiente", "agendada", "vencida", "cancelada"]),
  vacancy_title: z.string(),
  modality: z.enum(Constants.public.Enums.interview_modality),
  duration_minutes: z.number(),
  location: z.string().nullable(),
  expires_at: z.string(),
  scheduled_at: z.string().nullable(),
  slots: z.array(z.object({ id: z.uuid(), starts_at: z.string() })),
});

export type PublicBooking = {
  status: "pendiente" | "agendada" | "vencida" | "cancelada";
  vacancyTitle: string;
  modality: (typeof Constants.public.Enums.interview_modality)[number];
  durationMinutes: number;
  location: string | null;
  expiresAt: string;
  scheduledAt: string | null;
  slots: { id: string; startsAt: string }[];
};

/** La invitación del enlace, o null si el enlace no existe (o no tiene la forma de uno). */
export async function getPublicBooking(token: string): Promise<PublicBooking | null> {
  if (!isBookingTokenShape(token)) return null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_interview_booking", { p_token_hash: hashBookingToken(token) });
  if (error) throw error;
  if (!data) return null;
  const parsed = publicBookingSchema.parse(data);
  return {
    status: parsed.status,
    vacancyTitle: parsed.vacancy_title,
    modality: parsed.modality,
    durationMinutes: parsed.duration_minutes,
    location: parsed.location,
    expiresAt: parsed.expires_at,
    scheduledAt: parsed.scheduled_at,
    slots: parsed.slots.map((slot) => ({ id: slot.id, startsAt: slot.starts_at })),
  };
}

/**
 * Tarea diaria: las invitaciones que pasaron su plazo quedan «vencida» y quien
 * invitó recibe el aviso en la campana. Devuelve cuántas venció (null si falló;
 * no corta la tarea de recordatorios).
 */
export async function expireInterviewBookings(admin: ReturnType<typeof createSupabaseAdminClient>): Promise<number | null> {
  try {
    const { data, error } = await admin.rpc("expire_interview_bookings");
    if (error) throw error;
    return data ?? 0;
  } catch (error) {
    logServerError("interview.booking.expire", error);
    return null;
  }
}
