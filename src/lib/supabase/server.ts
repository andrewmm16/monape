import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/env";
import type { Database } from "@/types/database";

export type AppSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Cliente de Supabase con la sesión del usuario (cookies). Todas las consultas
 * quedan sujetas a RLS. Crear uno por solicitud; nunca compartirlo.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde un Server Component: el proxy renueva la sesión.
        }
      },
    },
  });
}
