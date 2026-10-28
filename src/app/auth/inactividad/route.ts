import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { ACTIVITY_COOKIE } from "@/lib/auth/inactivity";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Cierra la sesión cuando vence el aviso de inactividad del navegador. Es POST
 * (formulario del mismo sitio; las cookies de sesión son SameSite=Lax) para que
 * otra página no pueda forzar el cierre. Solo cierra la sesión de este
 * navegador: las abiertas en otros equipos continúan.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(ACTIVITY_COOKIE);

  const url = request.nextUrl.clone();
  url.pathname = "/ingresar";
  url.search = "";
  url.searchParams.set("motivo", "inactividad");
  const next = formData?.get("next");
  if (typeof next === "string" && next) url.searchParams.set("next", safeNextPath(next));
  // 303: el navegador sigue la redirección con GET.
  return NextResponse.redirect(url, 303);
}
