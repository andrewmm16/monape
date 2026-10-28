"use server";

import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requireActiveUser } from "@/lib/auth/session";
import { toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Marca como leídas las notificaciones indicadas, o todas si no se indica
 * ninguna. RLS limita la operación a las notificaciones propias.
 */
export async function markNotificationsRead(ids?: number[]): Promise<ActionResult> {
  return runAction("notifications.read", async () => {
    await requireActiveUser();
    const values = parseInput(z.array(z.number().int().positive()).max(100).optional(), ids);
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (values) query = query.in("id", values);
    const { error } = await query;
    if (error) throw toAppError(error);
    return null;
  });
}
