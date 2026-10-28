import { NextResponse } from "next/server";
import { touchActivityCookie } from "@/lib/auth/activity-cookie";
import { requireActiveUser } from "@/lib/auth/session";
import { AppError, logServerError } from "@/lib/errors";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Registra la actividad del usuario con la hora del servidor. El aviso de
 * inactividad la envía como máximo una vez por minuto; el proxy ya rechazó
 * las sesiones vencidas antes de llegar aquí.
 */
export async function POST() {
  try {
    const user = await requireActiveUser();
    await touchActivityCookie(user.id);
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    const rejected = error instanceof AppError && (error.code === "unauthenticated" || error.code === "forbidden");
    if (!rejected) logServerError("session.activity", error);
    return new NextResponse(null, { status: rejected ? 401 : 500, headers: NO_STORE });
  }
}
