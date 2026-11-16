import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AppError, logServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildApplicationsCsv, exportFilename } from "@/modules/reports/csv";
import { getVacancyExportRows, logReportExport } from "@/modules/reports/queries";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

const STATUS_BY_CODE: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
};

/**
 * Exporta a CSV las postulaciones de una vacante.
 *  1. sesión activa con permiso de gestión de postulaciones (solo staff);
 *  2. la vacante debe ser visible para el usuario (RLS);
 *  3. auditoría obligatoria con identificadores (si falla, no se entrega);
 *  4. respuesta como descarga, sin caché.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requirePermission("applications:manage");
    const vacancyId = z.uuid().safeParse(request.nextUrl.searchParams.get("vacante"));
    if (!vacancyId.success) throw new AppError("Solicitud inválida.", "validation");

    const supabase = await createSupabaseServerClient();
    const result = await getVacancyExportRows(supabase, vacancyId.data);
    if (!result) throw new AppError("No encontrado.", "not_found");

    await logReportExport(user.id, result.vacancyId, result.rows.length);

    const csv = buildApplicationsCsv(result.rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(result.vacancyId)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logServerError("reportes.export", error);
    const code = error instanceof AppError ? error.code : "internal";
    const message = error instanceof AppError ? error.message : "No se pudo generar la exportación.";
    return NextResponse.json({ error: message }, { status: STATUS_BY_CODE[code] ?? 500, headers: NO_STORE });
  }
}
