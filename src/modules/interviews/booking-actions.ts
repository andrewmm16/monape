"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { autoEnqueueDeepDive } from "@/modules/evaluation/ai-queue";
import { rateLimitSubject } from "@/modules/online-apply/subject";
import { BOOKING_PUBLIC_MESSAGES } from "./booking";
import { hashBookingToken, isBookingTokenShape } from "./booking-token";
import { scheduleInterviewEmail } from "./emails";

export type BookSlotResult = { ok: true; scheduledAt: string } | { ok: false; message: string };

const MESSAGES = BOOKING_PUBLIC_MESSAGES;

/**
 * La persona candidata elige un horario desde su enlace (página pública, sin
 * sesión). La base valida el token y el horario en una transacción y crea la
 * entrevista; después salen los correos de siempre y se encolan las preguntas
 * para profundizar. Nunca expone detalles internos.
 */
export async function bookInterviewSlot(token: string, slotId: string): Promise<BookSlotResult> {
  if (!isBookingTokenShape(token) || !z.uuid().safeParse(slotId).success) return { ok: false, message: MESSAGES.closed };
  try {
    const env = getServerEnv();
    const admin = createSupabaseAdminClient();
    // Sin secreto no se calcula el límite de intentos: se falla (mensaje genérico) en vez de usar uno vacío.
    const secret = env.INTAKE_HASH_SECRET || env.SUPABASE_SECRET_KEY;
    if (!secret) throw new Error("Falta el secreto del límite de intentos de la autoagenda");
    const { data: allowed, error: limitError } = await admin.rpc("consume_booking_rate_limit", {
      p_subject: rateLimitSubject(secret, await headers()),
    });
    if (limitError) throw limitError;
    if (allowed !== true) return { ok: false, message: MESSAGES.rateLimited };

    const { data: interviewId, error } = await admin.rpc("book_interview_slot", {
      p_token_hash: hashBookingToken(token),
      p_slot_id: slotId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "RH409" && /horario/i.test(error.message)) return { ok: false, message: MESSAGES.unavailable };
      if (code === "RH409" || code === "RH404") return { ok: false, message: MESSAGES.closed };
      throw error;
    }

    const { data: interview, error: readError } = await admin
      .from("interviews")
      .select("application_id, scheduled_at")
      .eq("id", interviewId)
      .single();
    if (readError) throw readError;
    // Mismos avisos que una entrevista programada por RRHH (a la persona y a los entrevistadores).
    scheduleInterviewEmail(admin, "invitation", interviewId);
    await autoEnqueueDeepDive(admin, interview.application_id, { system: true });
    revalidatePath(`/postulaciones/${interview.application_id}`);
    revalidatePath("/entrevistas");
    return { ok: true, scheduledAt: interview.scheduled_at };
  } catch (error) {
    logServerError("interview.booking.book", error);
    return { ok: false, message: MESSAGES.generic };
  }
}
