import "server-only";
import { toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";

/** Resumen de lo que hizo el robot en el día (hora de Perú). */
export type BotDailySummary = {
  /** Vacantes distintas publicadas hoy por el robot. */
  publishedToday: number;
  /** Postulantes que el robot trajo hoy. */
  applicantsToday: number;
};

/** Perú no usa horario de verano: siempre UTC-5. */
const LIMA_OFFSET_MINUTES = -5 * 60;

/** Medianoche de hoy en hora de Perú, como instante UTC en ISO (para comparar con columnas `timestamptz`). */
export function startOfDayLima(now: Date): string {
  const limaWall = new Date(now.getTime() + LIMA_OFFSET_MINUTES * 60_000);
  const midnightUtc = Date.UTC(limaWall.getUTCFullYear(), limaWall.getUTCMonth(), limaWall.getUTCDate());
  return new Date(midnightUtc - LIMA_OFFSET_MINUTES * 60_000).toISOString();
}

/** Números del día para el resumen del panel y del aviso por WhatsApp. */
export async function getBotDailySummary(supabase: AppSupabaseClient, now: Date = new Date()): Promise<BotDailySummary> {
  const since = startOfDayLima(now);
  const published = await supabase
    .from("portal_publications")
    .select("vacancy_id")
    .eq("manual", false)
    .gte("published_at", since);
  if (published.error) throw toAppError(published.error);
  const applicants = await supabase
    .from("integration_submissions")
    .select("id")
    .eq("provider", "portal_bot")
    .eq("status", "registrada")
    .gte("received_at", since);
  if (applicants.error) throw toAppError(applicants.error);

  const vacancies = new Set((published.data ?? []).map((row: { vacancy_id: string | null }) => row.vacancy_id));
  return { publishedToday: vacancies.size, applicantsToday: (applicants.data ?? []).length };
}
