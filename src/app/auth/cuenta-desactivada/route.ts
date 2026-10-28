import { type NextRequest, NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Cierra la sesión de una cuenta desactivada que aún conserva un token válido
 * (las páginas no pueden modificar cookies). Solo actúa si la cuenta está
 * efectivamente desactivada, para no permitir cierres de sesión forzados.
 */
export async function GET(request: NextRequest) {
  const state = await getSessionState();
  const url = request.nextUrl.clone();
  url.search = "";
  if (state.status === "inactive") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
    url.pathname = "/ingresar";
    url.searchParams.set("motivo", "cuenta-desactivada");
  } else {
    url.pathname = state.status === "active" ? "/panel" : "/ingresar";
  }
  return NextResponse.redirect(url);
}
