import "server-only";
import { getServerEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/modules/integrations/talent-apply/token";

/** Respuestas sin caché y sin repetir nunca la entrada recibida. */
const RESPONSE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Portales que el robot atiende, por el nombre corto que usa en las solicitudes. */
const PORTAL_NAMES: Record<string, string> = {
  "trabajos-diarios": "Trabajos Diarios",
  linkedin: "LinkedIn",
  bumeran: "Bumeran",
  indeed: "Indeed",
  computrabajo: "Computrabajo",
};

export function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

/**
 * Comprueba `Authorization: Bearer <PORTAL_BOT_SECRET>`. Devuelve una respuesta
 * 404 si la API está apagada o el secreto no coincide (no se distingue), o null
 * si la solicitud está autorizada.
 */
export function rejectUnlessBot(request: Request): Response | null {
  const secret = getServerEnv().PORTAL_BOT_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!secret || token === "" || !safeEqual(token, secret)) return json(404, { error: "no_encontrado" });
  return null;
}

/** Id del portal del catálogo para el nombre corto, o null si no existe o no admite al robot. */
export async function resolvePortalId(admin: AdminClient, slug: unknown): Promise<string | null> {
  const name = typeof slug === "string" ? PORTAL_NAMES[slug] : undefined;
  if (!name) return null;
  const { data, error } = await admin.from("job_portals").select("id").eq("name", name).eq("bot_enabled", true).maybeSingle();
  // Una caída de la base de datos no es «portal no encontrado»: que llegue como 500 y el robot reintente.
  if (error) throw error;
  return data?.id ?? null;
}

/** Código HTTP de un error de la base de datos (RH404, RH409, RH422 y restricciones). */
export function httpStatusOf(error: unknown): number {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "RH404") return 404;
  if (code === "RH409") return 409;
  if (code === "RH422" || code === "23514" || code === "22P02") return 422;
  return 500;
}
