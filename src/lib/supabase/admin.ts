import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { Database } from "@/types/database";

/**
 * Cliente con la clave secreta: OMITE RLS. Uso restringido a:
 *  - Supabase Auth: invitar, bloquear y desbloquear cuentas;
 *  - Storage: subir y firmar descargas de CV (los usuarios no tienen acceso
 *    directo al bucket);
 *  - Parte pública (2.9): funciones public_* de la base de datos, que solo
 *    ejecuta service_role y devuelven una lista cerrada de columnas.
 * Quien lo use debe haber verificado antes la sesión, el rol y el acceso al
 * registro con el cliente del usuario (RLS).
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  if (!env.SUPABASE_SECRET_KEY) {
    throw new AppError("Falta configurar la clave de servicio de Supabase en el servidor.", "unavailable");
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
