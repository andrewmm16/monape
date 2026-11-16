import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { AppError, logServerError } from "@/lib/errors";
import { searchPlaces } from "@/modules/interviews/place-search";

const NO_STORE = { "Cache-Control": "no-store" };

const MIN_QUERY = 3;
const MAX_QUERY = 200;

const MIN_INTERVAL_MS = 1_000;
const RATE_MAX_USERS = 1_000;

// En memoria del proceso: frena a quien dispare solicitudes sin pausa (~1 por segundo).
const lastRequestAt = new Map<string, number>();

function isRateLimited(userId: string, now: number): boolean {
  const last = lastRequestAt.get(userId);
  if (last !== undefined && now - last < MIN_INTERVAL_MS) return true;
  if (lastRequestAt.size >= RATE_MAX_USERS) {
    for (const [id, at] of lastRequestAt) if (now - at >= MIN_INTERVAL_MS) lastRequestAt.delete(id);
  }
  lastRequestAt.set(userId, now);
  return false;
}

/**
 * Sugerencias de direcciones para el formulario de entrevistas. El navegador no
 * llama a Photon: lo hace el servidor (`searchPlaces`), con caché de 5 minutos y un
 * límite de una solicitud por segundo por usuario. Solo personal que gestiona postulaciones.
 */
export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requirePermission("applications:manage")).id;
  } catch (error) {
    if (error instanceof AppError && error.code === "unauthenticated") {
      return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });
    }
    if (error instanceof AppError && error.code === "forbidden") {
      return NextResponse.json({ error: "No tiene permisos para buscar direcciones." }, { status: 403, headers: NO_STORE });
    }
    logServerError("places.search.auth", error);
    return NextResponse.json({ error: "No se pudo verificar su sesión." }, { status: 500, headers: NO_STORE });
  }

  const raw = (request.nextUrl.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (raw.length < MIN_QUERY || raw.length > MAX_QUERY) {
    return NextResponse.json(
      { error: `Escriba entre ${MIN_QUERY} y ${MAX_QUERY} caracteres para buscar.` },
      { status: 400, headers: NO_STORE },
    );
  }

  if (isRateLimited(userId, Date.now())) {
    return NextResponse.json(
      { error: "Demasiadas búsquedas seguidas. Espere un momento." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "1" } },
    );
  }

  try {
    return NextResponse.json(await searchPlaces(raw), { headers: NO_STORE });
  } catch (error) {
    logServerError("places.search", error);
    return NextResponse.json(
      { error: "No se pudo buscar la dirección. Escríbala a mano." },
      { status: 502, headers: NO_STORE },
    );
  }
}
