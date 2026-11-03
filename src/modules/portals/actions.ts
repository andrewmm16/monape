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

/**
 * RRHH publicó la oferta a mano en un portal y registra su código (y, si lo tiene, el
 * enlace) para que el lector de correo ligue los avisos de postulación con la vacante.
 * Repetirlo sobre una publicación manual corrige el código.
 */
export async function markPortalPublishedManually(
  vacancyId: string,
  portalId: string,
  externalId: string,
  externalUrl?: string,
): Promise<ActionResult> {
  return runAction("portals.mark_published_manually", async () => {
    await requirePermission("vacancies:manage");
    const vacancy = parseInput(z.uuid(), vacancyId);
    const portal = parseInput(z.uuid(), portalId);
    const code = parseInput(z.string().trim().min(1, "Escriba el código de la oferta.").max(200, "El código es demasiado largo."), externalId);
    const url = parseInput(z.string().trim().max(500, "El enlace es demasiado largo.").optional(), externalUrl);
    if (url && !url.startsWith("https://")) throw new AppError("El enlace debe empezar por https://.", "validation");
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("mark_portal_published_manually", {
      p_vacancy_id: vacancy,
      p_portal_id: portal,
      p_external_id: code,
      p_external_url: url || null,
    });
    if (error) throw toAppError(error);
    revalidatePath(`/vacantes/${vacancy}`);
    return null;
  }, "Publicación registrada. El lector de correo la usará para ligar las postulaciones.");
}

/** RRHH retiró a mano una oferta que había registrado como publicada a mano. */
export async function markPortalWithdrawnManually(publicationId: string, vacancyId: string): Promise<ActionResult> {
  return runAction("portals.mark_withdrawn_manually", async () => {
    await requirePermission("vacancies:manage");
    const publication = parseInput(z.uuid(), publicationId);
    const vacancy = parseInput(z.uuid(), vacancyId);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("mark_portal_withdrawn_manually", { p_publication_id: publication });
    if (error) throw toAppError(error);
    revalidatePath(`/vacantes/${vacancy}`);
    return null;
  }, "Publicación marcada como retirada.");
}
