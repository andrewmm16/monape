import { sendDueInterviewReminders } from "@/modules/interviews/emails";
import { runScheduledTask } from "@/modules/scheduled-tasks/auth";

export const dynamic = "force-dynamic";

/** Tarea programada: recordatorios de entrevista (ver docs/despliegue.md). */
export async function GET(request: Request) {
  return runScheduledTask(request, "recordatorios_entrevista", (admin) => sendDueInterviewReminders(admin));
}
