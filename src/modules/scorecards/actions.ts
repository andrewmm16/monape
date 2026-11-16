"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { saveScorecardSchema, type SaveScorecardInput } from "./schemas";

/**
 * Crea o actualiza la evaluación (scorecard) del usuario actual sobre una
 * postulación. Una por evaluador (upsert). No cambia el estado del proceso ni la
 * puntuación del motor: es un insumo para la decisión humana.
 */
export async function saveScorecard(input: SaveScorecardInput): Promise<ActionResult> {
  return runAction("scorecards.save", async () => {
    const user = await requirePermission("applications:manage");
    const values = parseInput(saveScorecardSchema, input);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("application_scorecards").upsert(
      {
        application_id: values.applicationId,
        evaluator_id: user.id,
        recommendation: values.recommendation,
        comment: values.comment ? values.comment : null,
        scores: values.scores,
      },
      { onConflict: "application_id,evaluator_id" },
    );
    if (error) throw toAppError(error);
    revalidatePath(`/postulaciones/${values.applicationId}`);
    return null;
  });
}

/** Elimina la evaluación del usuario actual sobre una postulación. */
export async function deleteScorecard(applicationId: string): Promise<ActionResult> {
  return runAction("scorecards.delete", async () => {
    const user = await requirePermission("applications:manage");
    const id = parseInput(z.uuid(), applicationId);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("application_scorecards")
      .delete()
      .eq("application_id", id)
      .eq("evaluator_id", user.id);
    if (error) throw toAppError(error);
    revalidatePath(`/postulaciones/${id}`);
    return null;
  });
}
