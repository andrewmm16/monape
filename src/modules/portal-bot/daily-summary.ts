import "server-only";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getBotDailySummary } from "@/modules/portals/daily-summary";
import { resumenDiarioLinea } from "@/modules/portals/estado-ui";
import { listBotPortalStatuses } from "@/modules/portals/queries";
import { httpStatusOf, json, rejectUnlessBot } from "./auth";

/**
 * GET /api/bot/resumen-diario: el robot pide el resumen del día para enviarlo
 * por WhatsApp. Devuelve la frase ya redactada (la misma del panel), para no
 * duplicar la lógica en el robot. No lleva datos personales.
 */
export async function botDailySummary(request: Request): Promise<Response> {
  const denied = rejectUnlessBot(request);
  if (denied) return denied;
  try {
    const admin = createSupabaseAdminClient();
    const [statuses, daily] = await Promise.all([listBotPortalStatuses(admin), getBotDailySummary(admin)]);
    const needingAttention = statuses.filter((s) => s.nivel === "atencion" || s.nivel === "error").length;
    return json(200, {
      linea: resumenDiarioLinea(daily, statuses),
      publishedToday: daily.publishedToday,
      applicantsToday: daily.applicantsToday,
      needingAttention,
    });
  } catch (error) {
    logServerError("bot.resumen_diario", error);
    const status = httpStatusOf(error);
    return json(status, { error: status === 500 ? "error_interno" : "solicitud_rechazada" });
  }
}
