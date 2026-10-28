import "server-only";
import { z } from "zod";
import { AppError, toAppError } from "@/lib/errors";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { Constants } from "@/types/database";

const summarySchema = z.object({
  active_vacancies: z.number(),
  draft_vacancies: z.number(),
  vacancies_pending_criteria: z.number(),
  applications_by_status: z.partialRecord(z.enum(Constants.public.Enums.application_status), z.number()),
  candidates_per_vacancy: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      department: z.string(),
      total: z.number(),
      without_evaluation: z.number(),
    }),
  ),
  pending_evaluations: z.number(),
  pending_reviews: z.number(),
  recent_activity: z.array(
    z.object({
      id: z.number(),
      created_at: z.string(),
      event_type: z.enum(Constants.public.Enums.application_event_type),
      from_status: z.enum(Constants.public.Enums.application_status).nullable(),
      to_status: z.enum(Constants.public.Enums.application_status).nullable(),
      application_id: z.string(),
      candidate_name: z.string(),
      vacancy_title: z.string(),
      actor_name: z.string().nullable(),
    }),
  ),
});

export type DashboardSummary = z.infer<typeof summarySchema>;

/** Indicadores calculados en la base de datos con el ámbito del usuario (RLS). */
export async function getDashboardSummary(supabase: AppSupabaseClient): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc("get_dashboard_summary");
  if (error) throw toAppError(error);
  const parsed = summarySchema.safeParse(data);
  if (!parsed.success) throw new AppError("No se pudieron interpretar los indicadores del panel.", "internal");
  return parsed.data;
}
