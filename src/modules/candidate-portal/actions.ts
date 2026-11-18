"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isCandidatePortalEnabled, trackingUrl } from "./queries";

/** Enciende o apaga el portal del candidato (solo administración). */
export async function setCandidatePortalEnabled(enabled: boolean): Promise<ActionResult> {
  return runAction(
    "candidate_portal.toggle",
    async () => {
      await requirePermission("candidate_portal:manage");
      const value = parseInput(z.boolean(), enabled);
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("candidate_portal_settings")
        .update({ enabled: value })
        .eq("id", true)
        .select("enabled");
      if (error) throw toAppError(error);
      if (!data?.length) throw new AppError("No se pudo cambiar el portal del candidato.", "forbidden");
      revalidatePath("/configuracion/portal-candidato");
      return null;
    },
    enabled ? "Portal del candidato encendido." : "Portal del candidato apagado.",
  );
}

/**
 * Enlace de seguimiento de una postulación, para copiarlo y enviarlo. Es el
 * mismo que va en los correos; con `renew` se genera uno nuevo y el anterior
 * deja de funcionar (p. ej., si se envió a quien no correspondía).
 */
export async function getTrackingLink(applicationId: string, renew = false): Promise<ActionResult<{ url: string }>> {
  return runAction(
    "candidate_portal.link",
    async () => {
      await requirePermission("applications:manage");
      const id = parseInput(z.uuid(), applicationId);
      const supabase = await createSupabaseServerClient();
      if (!(await isCandidatePortalEnabled(supabase))) {
        throw new AppError("El portal del candidato está apagado.", "conflict");
      }
      const { data, error } = await supabase.rpc("get_application_tracking_link", {
        p_application_id: id,
        p_renew: parseInput(z.boolean(), renew),
      });
      if (error) throw toAppError(error);
      return { url: trackingUrl(data) };
    },
    renew ? "Enlace renovado. El anterior dejó de funcionar." : undefined,
  );
}
