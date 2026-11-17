"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveScorecardSchema, type SaveScorecardInput } from "./schemas";

/** Devuelve la postulación y el estado de la entrevista, o lanza si no existe/sin acceso. */
async function loadInterview(interviewId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("interviews")
    .select("application_id, status")
    .eq("id", interviewId)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) throw new AppError("La entrevista no existe.", "not_found");
  return { supabase, applicationId: data.application_id, status: data.status };
}

/**
 * Crea o actualiza la evaluación (scorecard) del usuario actual sobre una
 * ENTREVISTA realizada. Una por evaluador y entrevista. No cambia el estado del
 * proceso ni la puntuación del motor: es un insumo para la decisión humana,
 * basado en lo observado en la entrevista.
 *
 * No usa upsert: PostgREST lo traduce a ON CONFLICT DO UPDATE sobre TODAS las
 * columnas enviadas (incluidas interview_id y evaluator_id), y la tabla solo
 * permite actualizar recommendation, comment y scores. Por eso se busca la
 * tarjeta propia y se actualiza solo lo editable, o se crea si no existe.
 */
export async function saveScorecard(input: SaveScorecardInput): Promise<ActionResult> {
  return runAction("scorecards.save", async () => {
    const user = await requirePermission("applications:manage");
    const values = parseInput(saveScorecardSchema, input);
    const { supabase, applicationId, status } = await loadInterview(values.interviewId);
    if (status !== "realizada") {
      throw new AppError("Solo puedes evaluar una entrevista con resultado registrado.", "conflict");
    }
    const editable = {
      recommendation: values.recommendation,
      comment: values.comment ? values.comment : null,
      scores: values.scores,
    };
    const { data: existing, error: lookupError } = await supabase
      .from("interview_scorecards")
      .select("id")
      .eq("interview_id", values.interviewId)
      .eq("evaluator_id", user.id)
      .maybeSingle();
    if (lookupError) throw toAppError(lookupError);
    const { error } = existing
      ? await supabase.from("interview_scorecards").update(editable).eq("id", existing.id)
      : await supabase
          .from("interview_scorecards")
          .insert({ interview_id: values.interviewId, evaluator_id: user.id, ...editable });
    if (error) throw toAppError(error);
    revalidatePath(`/postulaciones/${applicationId}`);
    return null;
  });
}

/** Elimina la evaluación del usuario actual sobre una entrevista. */
export async function deleteScorecard(interviewId: string): Promise<ActionResult> {
  return runAction("scorecards.delete", async () => {
    const user = await requirePermission("applications:manage");
    const id = parseInput(z.uuid(), interviewId);
    const { supabase, applicationId } = await loadInterview(id);
    const { error } = await supabase
      .from("interview_scorecards")
      .delete()
      .eq("interview_id", id)
      .eq("evaluator_id", user.id);
    if (error) throw toAppError(error);
    revalidatePath(`/postulaciones/${applicationId}`);
    return null;
  });
}
