import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { touchActivityCookie } from "@/lib/auth/activity-cookie";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Tipos de enlace aceptados: invitación de usuarios y recuperación de contraseña. */
const ALLOWED_TYPES: EmailOtpType[] = ["invite", "recovery"];

/**
 * Verifica el token de los correos de Supabase Auth (flujo `token_hash`) y
 * crea la sesión. Las plantillas de correo deben apuntar a esta ruta
 * (ver supabase/templates y docs/configuracion-supabase.md).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/restablecer");

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    const [pathname, search = ""] = path.split("?");
    url.pathname = pathname!;
    url.search = search;
    return NextResponse.redirect(url);
  };

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      // La sesión nueva empieza con actividad registrada (ver lib/auth/inactivity).
      await touchActivityCookie(data.user.id);
      return redirectTo(next);
    }
  }
  return redirectTo("/ingresar?motivo=enlace-invalido");
}
