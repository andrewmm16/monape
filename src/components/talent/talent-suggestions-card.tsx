import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { VacancySuggestions } from "@/components/talent/vacancy-suggestions";
import { logServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEmailReplyTo } from "@/modules/email-templates/queries";
import { suggestCandidatesForVacancy } from "@/modules/talent-pool/matching";

const TITLE = "Candidatos de la base de talentos que encajan";

/**
 * Talento sugerido: personas del histórico evaluadas con el motor frente a los
 * requisitos de la vacante. Va dentro de <Suspense>: evaluar la base de talentos
 * no demora el resto de la página. Sin coincidencias (o si falla) no se muestra.
 */
export async function TalentSuggestionsCard({ vacancyId }: { vacancyId: string }) {
  const supabase = await createSupabaseServerClient();
  const [candidates, replyTo] = await Promise.all([
    suggestCandidatesForVacancy(supabase, vacancyId).catch((error: unknown) => {
      logServerError("talent.suggestions", error);
      return [];
    }),
    // Un fallo al leerlo solo deja el botón de invitar bloqueado, no rompe la página.
    getEmailReplyTo(supabase).catch(() => null),
  ]);
  if (candidates.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{TITLE}</CardTitle>
        <CardDescription>
          Personas del histórico, disponibles para reactivar, evaluadas con el motor frente a los requisitos de esta vacante.
          Invitar requiere su consentimiento.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VacancySuggestions vacancyId={vacancyId} candidates={candidates} replyToConfigured={Boolean(replyTo)} />
      </CardContent>
    </Card>
  );
}

/** Mientras se evalúa la base de talentos. */
export function TalentSuggestionsSkeleton() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>{TITLE}</CardTitle>
        <CardDescription>Buscando en la base de talentos…</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-5/6" />
      </CardContent>
    </Card>
  );
}
