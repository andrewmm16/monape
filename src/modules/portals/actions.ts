"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { AppError, toAppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * RRHH edita los portales de una vacante: publica en los que se marcaron y
 * retira de los que se desmarcaron. Cada portal se procesa por separado: si
 * alguno falla (no admite al robot, cambió de estado), los demás siguen y se
 * informa cuántos cambios se lograron.
 */
export async function applyPortalSelection(vacancyId: string, add: string[], remove: string[]): Promise<ActionResult> {
  const result = await runAction("portals.apply_selection", async () => {
    await requirePermission("vacancies:manage");
    const vacancy = parseInput(z.uuid(), vacancyId);
    const portalList = z.array(z.uuid()).max(20);
    const toAdd = [...new Set(parseInput(portalList, add))];
    const toRemove = [...new Set(parseInput(portalList, remove))];
    if (toAdd.length + toRemove.length === 0) throw new AppError("No hay cambios que aplicar.", "validation");
    const supabase = await createSupabaseServerClient();

    let published = 0;
    let withdrawn = 0;
    let firstError: Parameters<typeof toAppError>[0] | null = null;
    for (const portal of toAdd) {
      const { error } = await supabase.rpc("request_portal_publication", { p_vacancy_id: vacancy, p_portal_id: portal });
      if (error) firstError ??= error;
      else published++;
    }
    for (const portal of toRemove) {
      const { data, error: lookupError } = await supabase
        .from("portal_publications")
        .select("id")
        .eq("vacancy_id", vacancy)
        .eq("portal_id", portal)
        .maybeSingle();
      const { error } = data
        ? await supabase.rpc("request_portal_withdrawal", { p_publication_id: data.id })
        : { error: lookupError };
      if (error) firstError ??= error;
      else if (data) withdrawn++;
    }
    revalidatePath(`/vacantes/${vacancy}`);
    const done = published + withdrawn;
    if (done === 0 && firstError) throw toAppError(firstError);
    return { published, withdrawn, failed: toAdd.length + toRemove.length - done };
  });
  if (!result.ok) return result;

  const { published, withdrawn, failed } = result.data;
  const parts = [
    published > 0 ? `publicación solicitada en ${published}` : null,
    withdrawn > 0 ? `retiro solicitado en ${withdrawn}` : null,
  ].filter(Boolean);
  const summary = `Cambios guardados: ${parts.join(" y ")} portal(es). El robot los procesará en su próximo ciclo.`;
  return {
    ok: true,
    data: null,
    message: failed === 0 ? summary : `${summary} ${failed} cambio(s) no se pudo(ieron) aplicar; revise el estado de cada portal.`,
  };
}
