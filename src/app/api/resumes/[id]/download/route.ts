import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logResumeDownload } from "@/lib/audit";
import { requireActiveUser } from "@/lib/auth/session";
import { AppError, logServerError } from "@/lib/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RESUMES_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/modules/resumes/storage";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

const STATUS_BY_CODE: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  validation: 400,
};

/**
 * Única vía de descarga de un CV:
 *  1. sesión activa;
 *  2. el CV debe ser visible para el usuario (RLS sobre public.resumes);
 *  3. límite de solicitudes;
 *  4. auditoría obligatoria (si falla, no se entrega el archivo);
 *  5. URL firmada de 60 s generada con la clave de servicio (los usuarios no
 *     tienen acceso directo al bucket).
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireActiveUser();
    const { id } = await context.params;
    const resumeId = z.uuid().safeParse(id);
    if (!resumeId.success) throw new AppError("Solicitud inválida.", "validation");

    const supabase = await createSupabaseServerClient();
    await enforceRateLimit(supabase, RATE_LIMITS.cvDownload);

    const { data: resume } = await supabase
      .from("resumes")
      .select("id, storage_path, original_filename")
      .eq("id", resumeId.data)
      .maybeSingle();
    if (!resume) throw new AppError("No encontrado.", "not_found");

    await logResumeDownload(supabase, resume.id);

    const { data: signed, error } = await createSupabaseAdminClient()
      .storage.from(RESUMES_BUCKET)
      .createSignedUrl(resume.storage_path, SIGNED_URL_TTL_SECONDS, { download: resume.original_filename });
    if (error || !signed?.signedUrl) throw new AppError("No se pudo generar el enlace de descarga.", "unavailable");

    return NextResponse.redirect(signed.signedUrl, { status: 303, headers: NO_STORE });
  } catch (error) {
    logServerError("resumes.download", error);
    const code = error instanceof AppError ? error.code : "internal";
    const message = error instanceof AppError ? error.message : "No se pudo descargar el archivo.";
    return NextResponse.json({ error: message }, { status: STATUS_BY_CODE[code] ?? 500, headers: NO_STORE });
  }
}
