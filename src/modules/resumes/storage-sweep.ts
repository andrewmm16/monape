import "server-only";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { RESUMES_BUCKET } from "./storage";

/** Margen desde el último cambio del archivo: no se toca nada más reciente. */
export const ORPHAN_MIN_AGE_HOURS = 48;
const PAGE_SIZE = 100;
/** Tope por ejecución (el resto queda para la siguiente). */
const MAX_PAGES = 20;

export type StorageSweepResult = { simulated: boolean; found: number; removed: number; failed: number };

/**
 * Tarea programada (GET /api/tareas/limpieza-cv, con el cliente de servicio):
 * borra del bucket de CV los archivos que ya nada referencia (candidato o CV
 * eliminado, o una subida que no llegó a registrarse). La BD decide qué es
 * huérfano (list_orphan_resume_files); aquí solo se borra con la API de Storage.
 * Con `simulate` solo cuenta, sin borrar.
 */
export async function sweepOrphanResumeFiles(
  admin: AppSupabaseClient,
  { simulate = false }: { simulate?: boolean } = {},
): Promise<StorageSweepResult> {
  const result: StorageSweepResult = { simulated: simulate, found: 0, removed: 0, failed: 0 };
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await admin.rpc("list_orphan_resume_files", {
      p_min_age_hours: ORPHAN_MIN_AGE_HOURS,
      p_limit: simulate ? 1000 : PAGE_SIZE,
    });
    if (error) throw error;
    const names = (data ?? []).flatMap((row) => (row.name ? [row.name] : []));
    result.found += names.length;
    if (simulate || names.length === 0) break;

    const { data: removed, error: removeError } = await admin.storage.from(RESUMES_BUCKET).remove(names);
    if (removeError) {
      result.failed += names.length;
      break;
    }
    const removedCount = removed?.length ?? 0;
    result.removed += removedCount;
    result.failed += names.length - removedCount;
    // Sin avance (p. ej. archivos que Storage no reconoce): se corta para no repetir la misma página.
    if (removedCount === 0 || names.length < PAGE_SIZE) break;
  }
  return result;
}
