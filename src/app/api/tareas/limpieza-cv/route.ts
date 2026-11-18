import { sweepOrphanResumeFiles } from "@/modules/resumes/storage-sweep";
import { runScheduledTask } from "@/modules/scheduled-tasks/auth";

export const dynamic = "force-dynamic";

/**
 * Tarea programada: borra los CV huérfanos del bucket (ver docs/despliegue.md).
 * `?simular=1` solo cuenta, sin borrar.
 */
export async function GET(request: Request) {
  const simulate = new URL(request.url).searchParams.get("simular") === "1";
  return runScheduledTask(request, "limpieza_cv", (admin) => sweepOrphanResumeFiles(admin, { simulate }));
}
