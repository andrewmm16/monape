"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LEARNING_PAGE_PATH = "/configuracion/aprendizaje-motor";

/**
 * Deshacer: administración desactiva una regla aprendida (o reactiva una
 * suspendida o rechazada). La BD vuelve a comprobar el rol (RH403) y audita.
 */
export async function setLearnedRuleActive(id: string, active: boolean): Promise<ActionResult> {
  return runAction(
    "learning.set_active",
    async () => {
      await requirePermission("users:manage");
      const values = parseInput(z.object({ id: z.uuid(), active: z.boolean() }), { id, active });
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("set_learned_equivalence_active", { p_id: values.id, p_active: values.active });
      if (error) throw toAppError(error);
      revalidatePath(LEARNING_PAGE_PATH);
      return null;
    },
    active ? "Regla reactivada: el motor vuelve a aplicarla." : "Regla desactivada: el motor deja de aplicarla.",
  );
}
