"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isCandidatePortalEnabled } from "./queries";

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
 * Genera (o renueva) el enlace de seguimiento de una postulación. El enlace
 * anterior deja de funcionar. Devuelve la URL para copiarla y enviarla.
 */
export async function createTrackingLink(applicationId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(
    "candidate_portal.link",
    async () => {
      await requirePermission("applications:manage");
      const id = parseInput(z.uuid(), applicationId);
      const supabase = await createSupabaseServerClient();
      if (!(await isCandidatePortalEnabled(supabase))) {
        throw new AppError("El portal del candidato está apagado.", "conflict");
      }
      const { data, error } = await supabase.rpc("create_application_tracking_link", { p_application_id: id });
      if (error) throw toAppError(error);
      return { url: new URL(`/seguimiento/${data}`, getServerEnv().APP_URL).toString() };
    },
    "Enlace generado. El anterior, si existía, dejó de funcionar.",
  );
}
