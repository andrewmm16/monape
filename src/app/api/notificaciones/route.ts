import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth/session";
import { AppError, logServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getNotificationFeed } from "@/modules/notifications/queries";

const NO_STORE = { "Cache-Control": "no-store" };

/** Notificaciones del usuario de la sesión. La campana la consulta cada minuto. */
export async function GET() {
  try {
    await requireActiveUser();
    const supabase = await createSupabaseServerClient();
    return NextResponse.json(await getNotificationFeed(supabase), { headers: NO_STORE });
  } catch (error) {
    logServerError("notifications.feed", error);
    const status = error instanceof AppError && (error.code === "unauthenticated" || error.code === "forbidden") ? 401 : 500;
    return NextResponse.json({ error: "No se pudieron cargar las notificaciones." }, { status, headers: NO_STORE });
  }
}
