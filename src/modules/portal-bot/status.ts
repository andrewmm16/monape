import "server-only";
import { z } from "zod";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { httpStatusOf, json, rejectUnlessBot, resolvePortalId } from "./auth";

const statusBody = z.object({
  portal: z.string(),
  state: z.enum(["activo", "necesita_persona"]),
  reason: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
});

/** POST /api/bot/estado: el robot informa que sigue activo o que necesita a una persona. */
export async function reportBotStatus(request: Request): Promise<Response> {
  const denied = rejectUnlessBot(request);
  if (denied) return denied;
  let raw: unknown;
  try {
    raw = JSON.parse(await request.text());
  } catch {
    raw = undefined;
  }
  const body = statusBody.safeParse(raw);
  if (!body.success) return json(422, { error: "payload_invalido" });

  try {
    const admin = createSupabaseAdminClient();
    const portalId = await resolvePortalId(admin, body.data.portal);
    if (!portalId) return json(404, { error: "portal_no_encontrado" });
    const { error } = await admin.rpc("bot_report_status", {
      p_portal_id: portalId,
      p_state: body.data.state,
      p_reason: body.data.reason ?? null,
    });
    if (error) throw error;
    return json(200, { status: "ok" });
  } catch (error) {
    logServerError("bot.status", error);
    const status = httpStatusOf(error);
    return json(status, { error: status === 500 ? "error_interno" : "solicitud_rechazada" });
  }
}
