import { expireInterviewBookings } from "@/modules/interviews/booking-public";
import { sendDueInterviewReminders } from "@/modules/interviews/emails";
import { runScheduledTask } from "@/modules/scheduled-tasks/auth";

export const dynamic = "force-dynamic";

/**
 * Tarea programada: recordatorios de entrevista (ver docs/despliegue.md) y
 * vencimiento de las invitaciones a agendar (autoagenda).
 */
export async function GET(request: Request) {
  return runScheduledTask(request, "recordatorios_entrevista", async (admin) => {
    const reminders = await sendDueInterviewReminders(admin);
    const agendasVencidas = await expireInterviewBookings(admin);
    return { ...reminders, agendasVencidas };
  });
}
