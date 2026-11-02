"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { APPLICATION_STATUS_LABELS } from "@/lib/labels";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reevaluateAfterVerification } from "@/modules/evaluation/reevaluate";
import { limaToIso } from "./datetime";
import { listInterviewRequirements } from "./queries";
import {
  cancelInterviewSchema,
  recordResultSchema,
  rescheduleInterviewSchema,
  scheduleInterviewSchema,
  type CancelInterviewInput,
  type InterviewRequirement,
  type RecordResultInput,
  type RescheduleInterviewInput,
  type ScheduleInterviewInput,
} from "./schemas";

function revalidateInterviews(applicationId?: string) {
  revalidatePath("/entrevistas");
  revalidatePath("/panel");
  revalidatePath("/vacantes/[id]", "page");
  if (applicationId) revalidatePath(`/postulaciones/${applicationId}`);
}

/** Fecha y hora de Lima del formulario → ISO con -05:00 (el esquema ya las validó). */
function scheduledAtOf(values: { date: string; time: string }): string {
  const iso = limaToIso(values.date, values.time);
  if (!iso) throw new AppError("La fecha o la hora no son válidas.", "validation", { date: ["La fecha o la hora no son válidas"] });
  return iso;
}

/** Agenda una entrevista; si la postulación no lo estaba, pasa a «Entrevista programada». */
export async function scheduleInterview(input: ScheduleInterviewInput): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "interviews.schedule",
    async () => {
      await requirePermission("applications:manage");
      const values = parseInput(scheduleInterviewSchema, input);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc("schedule_interview", {
        p_application_id: values.applicationId,
        p_scheduled_at: scheduledAtOf(values),
        p_duration_minutes: Number(values.durationMinutes),
        p_modality: values.modality,
        p_location: values.location || null,
        p_interviewers: values.interviewers || null,
        p_instructions: values.instructions || null,
      });
      if (error) throw toAppError(error);
      revalidateInterviews(values.applicationId);
      return { id: data };
    },
    "Entrevista programada. La postulación quedó en «Entrevista programada».",
  );
}

export async function rescheduleInterview(input: RescheduleInterviewInput): Promise<ActionResult> {
  return runAction(
    "interviews.reschedule",
    async () => {
      await requirePermission("applications:manage");
      const values = parseInput(rescheduleInterviewSchema, input);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("reschedule_interview", {
        p_interview_id: values.interviewId,
        p_scheduled_at: scheduledAtOf(values),
        p_duration_minutes: Number(values.durationMinutes),
        p_modality: values.modality,
        p_location: values.location || null,
        p_interviewers: values.interviewers || null,
        p_instructions: values.instructions || null,
      });
      if (error) throw toAppError(error);
      revalidateInterviews();
      revalidatePath("/postulaciones/[id]", "page");
      return null;
    },
    "Entrevista reprogramada.",
  );
}

/** Cancela una entrevista programada. No cambia el estado de la postulación. */
export async function cancelInterview(input: CancelInterviewInput): Promise<ActionResult> {
  return runAction(
    "interviews.cancel",
    async () => {
      await requirePermission("applications:manage");
      const values = parseInput(cancelInterviewSchema, input);
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("cancel_interview", {
        p_interview_id: values.interviewId,
        p_reason: values.reason,
      });
      if (error) throw toAppError(error);
      revalidateInterviews();
      revalidatePath("/postulaciones/[id]", "page");
      return null;
    },
    "Entrevista cancelada. La postulación mantiene su estado.",
  );
}

type ResultOutcome = { applicationId: string; reevaluated: boolean | null };

/**
 * Registra el resultado de una entrevista: pasó, no pasó o no asistió. Un
 * «no pasó» mueve la postulación a «No seleccionado» (Descartados) sin borrar
 * nada. Los requisitos marcados se guardan con fuente «entrevista» y, igual que
 * al verificar a mano, la puntuación se recalcula con reglas (sin consumir el
 * límite de evaluaciones).
 */
export async function recordInterviewResult(input: RecordResultInput): Promise<ActionResult<ResultOutcome>> {
  const result = await runAction(
    "interviews.result",
    async () => {
      await requirePermission("applications:manage");
      const values = parseInput(recordResultSchema, input);
      const supabase = await createSupabaseServerClient();
      const verifications = values.outcome === "no_asistio" ? [] : values.verifications;
      const { data: applicationId, error } = await supabase.rpc("record_interview_result", {
        p_interview_id: values.interviewId,
        p_outcome: values.outcome,
        p_notes: values.notes || null,
        p_verifications: verifications.map((item) => ({
          requirement_id: item.requirementId,
          result: item.result,
          ...(item.note ? { note: item.note } : {}),
        })),
      });
      if (error) throw toAppError(error);

      let notice: string | null = null;
      let reevaluated: boolean | null = null;
      if (verifications.length > 0) {
        const outcome = await reevaluateAfterVerification(supabase, applicationId);
        reevaluated = outcome.reevaluated;
        notice = outcome.notice;
      }
      const { data: application } = await supabase.from("applications").select("status").eq("id", applicationId).maybeSingle();
      revalidateInterviews(applicationId);
      revalidatePath("/vacantes/[id]/comparar", "page");

      const status = application?.status;
      let message = "Resultado registrado.";
      if (status) {
        message += ` La postulación está en «${APPLICATION_STATUS_LABELS[status]}»`;
        message += status === "no_seleccionado" ? " y se movió a Descartados." : ".";
      }
      if (verifications.length > 0) {
        message += reevaluated
          ? " Puntuación recalculada con los requisitos comprobados."
          : ` Requisitos guardados. ${notice ?? ""}`.trimEnd();
      }
      return { applicationId, reevaluated, message };
    },
    undefined,
  );
  if (!result.ok) return result;
  const { message, ...data } = result.data;
  return { ok: true, data, message };
}

/** Requisitos vigentes de la vacante de la entrevista (para el diálogo del resultado). */
export async function loadInterviewRequirements(interviewId: string): Promise<ActionResult<InterviewRequirement[]>> {
  return runAction("interviews.requirements", async () => {
    await requirePermission("applications:manage");
    const id = parseInput(z.uuid(), interviewId);
    const supabase = await createSupabaseServerClient();
    return listInterviewRequirements(supabase, id);
  });
}
