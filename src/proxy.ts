import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { readActivityTime } from "@/lib/auth/activity-cookie";
import { ACTIVITY_COOKIE, IDLE_SIGN_OUT_PATH, isServerIdleExpired } from "@/lib/auth/inactivity";

/**
 * Rutas accesibles sin sesión. Todo lo demás exige autenticación.
 * /empleos, /robots.txt y /sitemap.xml son la parte pública (2.9): responden
 * 404 o vacío mientras PUBLIC_JOBS_ENABLED no sea "true".
 * /api/integraciones/talent/* (2.10) recibe las postulaciones de Talent Apply
 * (POST de un servidor externo, sin sesión) y entrega su feed: la protección es
 * el token de la URL y responden 404 mientras TALENT_APPLY_ENABLED no sea "true".
 */
const PUBLIC_PATHS = [
  "/ingresar",
  "/recuperar",
  "/auth/confirm",
  "/auth/cuenta-desactivada",
  "/empleos",
  "/robots.txt",
  "/sitemap.xml",
  "/api/integraciones/talent",
  IDLE_SIGN_OUT_PATH,
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Parte pública (2.9): no toca la sesión de Supabase ni lee o escribe cookies,
 * para que las respuestas cacheables nunca lleven Set-Cookie. Coincidencia
 * exacta de segmento: "/empleosx" sigue siendo privada.
 */
function isCookielessPublicPath(pathname: string): boolean {
  return (
    pathname === "/empleos" ||
    pathname.startsWith("/empleos/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/api/integraciones/talent/")
  );
}

function buildContentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Los componentes accesibles (Radix) posicionan elementos con estilos en línea.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Proxy de Next.js (antes "middleware"):
 *  1. Genera un nonce y la Content Security Policy de cada solicitud.
 *  2. Renueva la sesión de Supabase y propaga las cookies.
 *  3. Cierra la sesión tras 30 minutos sin actividad (ver lib/auth/inactivity).
 *  4. Redirige a /ingresar las solicitudes sin sesión (comprobación optimista;
 *     cada página, acción y ruta vuelve a verificar permisos en el servidor).
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const withSecurityHeaders = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  if (isCookielessPublicPath(request.nextUrl.pathname)) return withSecurityHeaders(response);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const { pathname, search } = request.nextUrl;

  let isAuthenticated = false;
  let idleExpired = false;
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [headerName, headerValue] of Object.entries(headers)) {
            response.headers.set(headerName, headerValue);
          }
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (userId) {
      isAuthenticated = true;
      idleExpired = isServerIdleExpired(readActivityTime(request.cookies.get(ACTIVITY_COOKIE)?.value, userId));
    }

    // Sesión abandonada (pestaña cerrada, equipo apagado): se cierra antes de
    // mostrar cualquier dato. En las rutas públicas no se cierra, para no
    // interferir con el ingreso ni con los enlaces de los correos.
    if (idleExpired && !isPublicPath(pathname)) {
      await supabase.auth.signOut({ scope: "local" });
      response.cookies.delete(ACTIVITY_COOKIE);
      isAuthenticated = false;
    }
  }

  // Las respuestas que reemplazan a `response` conservan las cookies que
  // Supabase renovó o borró, y no se guardan en cachés.
  const withSessionCookies = (target: NextResponse) => {
    for (const cookie of response.cookies.getAll()) target.cookies.set(cookie);
    target.headers.set("Cache-Control", "private, no-store");
    return target;
  };

  if (!isAuthenticated && !isPublicPath(pathname)) {
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        withSessionCookies(
          NextResponse.json({ error: "No autenticado" }, { status: 401, headers: { "Cache-Control": "no-store" } }),
        ),
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/ingresar";
    loginUrl.search = "";
    if (idleExpired) loginUrl.searchParams.set("motivo", "inactividad");
    if (pathname !== "/") loginUrl.searchParams.set("next", `${pathname}${search}`);
    return withSecurityHeaders(withSessionCookies(NextResponse.redirect(loginUrl)));
  }

  // Una sesión vencida por inactividad no vuelve al panel: si no se pudo
  // cerrar, eso provocaría un bucle de redirecciones.
  if (isAuthenticated && !idleExpired && pathname === "/ingresar") {
    const panelUrl = request.nextUrl.clone();
    panelUrl.pathname = "/panel";
    panelUrl.search = "";
    return withSecurityHeaders(withSessionCookies(NextResponse.redirect(panelUrl)));
  }

  // Las páginas privadas no deben almacenarse en cachés compartidas ni ser
  // modificadas por intermediarios (p. ej., la ofuscación de correos de
  // Cloudflare reescribe el HTML y rompe la hidratación de React).
  if (!isPublicPath(pathname)) response.headers.set("Cache-Control", "private, no-store, no-transform");
  return withSecurityHeaders(response);
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
