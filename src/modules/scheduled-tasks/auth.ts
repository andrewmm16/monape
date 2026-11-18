import "server-only";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/modules/integrations/talent-apply/token";

const MIN_SECRET_LENGTH = 32;
const RESPONSE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Secreto de las tareas programadas (/api/tareas/*). Se llama `CRON_SECRET`
 * porque es el nombre que usa Vercel Cron: con la variable definida, Vercel
 * envía `Authorization: Bearer <CRON_SECRET>` en cada ejecución. Cualquier otro
 * programador (pg_cron, GitHub Actions, el Programador de tareas de Windows)
 * puede llamar igual. Sin el secreto (o con menos de 32 caracteres) las tareas
 * quedan apagadas.
 */
export function getCronSecret(): string | undefined {
  const value = process.env.CRON_SECRET?.trim();
  return value && value.length >= MIN_SECRET_LENGTH ? value : undefined;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

/**
 * Ejecuta una tarea programada con el cliente de servicio. Responde 404 si las
 * tareas están apagadas o el secreto no coincide (no se distingue). Devuelve y
 * registra solo contadores: nunca datos personales.
 */
export async function runScheduledTask(
  request: Request,
  name: string,
  task: (admin: AdminClient) => Promise<Record<string, unknown>>,
): Promise<Response> {
  const secret = getCronSecret();
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!secret || token === "" || !safeEqual(token, secret)) return json(404, { error: "no_encontrado" });
  try {
    const result = await task(createSupabaseAdminClient());
    console.info(`[tarea.${name}] ${JSON.stringify(result)}`);
    return json(200, result);
  } catch (error) {
    logServerError(`tarea.${name}`, error);
    return json(500, { error: "error_interno" });
  }
}
