import type { Metadata } from "next";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { InterviewItem } from "@/components/interviews/interview-item";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { groupByDay } from "@/modules/interviews/datetime";
import { listAgenda, listVacancyOptions, RECENT_DAYS, toInterviewItem } from "@/modules/interviews/queries";
import { interviewListParamsSchema } from "@/modules/interviews/schemas";

export const metadata: Metadata = { title: "Entrevistas" };

export default async function InterviewsPage({ searchParams }: PageProps<"/entrevistas">) {
  const user = await requirePageUser();
  if (!can(user.role, "applications:manage")) return <AccessDenied />;
  const params = interviewListParamsSchema.parse(await searchParams);
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const [agenda, vacancies] = await Promise.all([
    listAgenda(supabase, { vacancyId: params.vacante || undefined }, now),
    listVacancyOptions(supabase),
  ]);
  const pending = agenda.pending.map(toInterviewItem);
  const upcoming = agenda.upcoming.map(toInterviewItem);
  const recent = agenda.recent.map(toInterviewItem);
  const days = groupByDay(upcoming, now);
  const nothing = pending.length + upcoming.length + recent.length === 0;

  return (
    <>
      <PageHeader
        title="Entrevistas"
        description="Entrevistas agendadas, en hora de Perú (Lima). Para programar una, abra la postulación del candidato."
      />

      <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-label="Filtro de entrevistas">
        <NativeSelect name="vacante" defaultValue={params.vacante} aria-label="Vacante" className="sm:w-80">
          <NativeSelectOption value="">Todas las vacantes</NativeSelectOption>
          {vacancies.map((vacancy) => (
            <NativeSelectOption key={vacancy.id} value={vacancy.id}>
              {vacancy.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      {nothing ? (
        <EmptyState
          title="Todavía no hay entrevistas"
          description="Cuando programe una desde la ficha de una postulación, aparecerá aquí con su fecha, lugar y entrevistadores."
        />
      ) : null}

      {pending.length > 0 ? (
        <section
          aria-labelledby="pendientes"
          className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/30 dark:text-amber-50"
        >
          <div>
            <h2 id="pendientes" className="text-lg font-semibold">
              Pendientes de resultado ({pending.length})
            </h2>
            <p className="text-sm">Ya pasó la hora de estas entrevistas. Registre si el candidato pasó, no pasó o no asistió.</p>
          </div>
          <ul className="space-y-2 text-foreground">
            {pending.map((interview) => (
              <InterviewItem key={interview.id} interview={interview} highlight />
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="proximas" className="space-y-3">
        <h2 id="proximas" className="text-lg font-semibold">
          Próximas ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay entrevistas próximas agendadas.</p>
        ) : (
          days.map((day) => (
            <div key={day.key} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground capitalize first-letter:uppercase">{day.label}</h3>
              <ul className="space-y-2">
                {day.items.map((interview) => (
                  <InterviewItem key={interview.id} interview={interview} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="recientes" className="space-y-3">
        <div>
          <h2 id="recientes" className="text-lg font-semibold">
            Realizadas recientemente ({recent.length})
          </h2>
          <p className="text-sm text-muted-foreground">Cerradas en los últimos {RECENT_DAYS} días: con resultado, sin asistencia o canceladas.</p>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay entrevistas cerradas en este período.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((interview) => (
              <InterviewItem key={interview.id} interview={interview} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
