import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/common/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { ComparisonTable } from "@/components/vacancies/comparison-table";
import { can } from "@/lib/auth/permissions";
import { requirePageUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { loadComparison, type CompareCandidate } from "@/modules/applications/compare";
import { MAX_COMPARED, parseCompareIds, RANKING_EXPLANATION } from "@/modules/applications/ranking";
import { getVacancy, listRequirements } from "@/modules/vacancies/queries";

export const metadata: Metadata = { title: "Comparar candidatos" };

export default async function ComparePage({ params, searchParams }: PageProps<"/vacantes/[id]/comparar">) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const search = await searchParams;

  const supabase = await createSupabaseServerClient();
  const vacancy = await getVacancy(supabase, id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "not_found") notFound();
    throw error;
  });

  const best = search.mejores === "1";
  const parsed = best ? null : parseCompareIds(search.ids);
  const chosenIds = parsed?.ok ? parsed.ids : [];
  const keepChosenOrder = !best && search.orden === "elegido";

  let error: string | null = parsed && !parsed.ok ? parsed.error : null;
  let ranked: CompareCandidate[] = [];
  if (!error) {
    const result = await loadComparison(supabase, vacancy.id, best ? { best: true } : { ids: chosenIds });
    ranked = result.candidates;
    if (result.missing) {
      error =
        "Alguna postulación no se puede comparar: no es de esta vacante, no tiene evaluación o ya fue descartada (no seleccionada o retirada).";
    } else if (ranked.length < 2) {
      error =
        "No hay suficientes candidatos evaluados para comparar. Se necesitan al menos 2 postulaciones con evaluación que no estén descartadas.";
    }
  }

  const requirements = error ? [] : await listRequirements(supabase, vacancy.id);
  const rankOf = new Map(ranked.map((candidate, index) => [candidate.id, index + 1]));
  const columns = keepChosenOrder ? [...ranked].sort((a, b) => chosenIds.indexOf(a.id) - chosenIds.indexOf(b.id)) : ranked;

  const base = `/vacantes/${vacancy.id}/comparar`;
  const idsHref = (ids: string[], extra?: Record<string, string>) => {
    const query = new URLSearchParams({ ids: ids.join(","), ...extra });
    return `${base}?${query.toString()}`;
  };
  const columnIds = columns.map((candidate) => candidate.id);
  const removeHref = (candidateId: string) =>
    columnIds.length > 2
      ? idsHref(columnIds.filter((other) => other !== candidateId), keepChosenOrder ? { orden: "elegido" } : undefined)
      : null;

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        eyebrow={
          <Link href={`/vacantes/${vacancy.id}?tab=candidatos`} className="hover:underline">
            {vacancy.title}
          </Link>
        }
        title="Comparar candidatos"
        description={RANKING_EXPLANATION}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No se puede mostrar la comparación</AlertTitle>
          <AlertDescription>
            {error}{" "}
            <Link href={`/vacantes/${vacancy.id}?tab=candidatos`} className="underline">
              Volver a los candidatos
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {best ? (
              <span className="text-muted-foreground">
                Se muestran las {Math.min(MAX_COMPARED, ranked.length)} mejores opciones, de la mejor a la peor.
              </span>
            ) : (
              <>
                <span className="text-muted-foreground">Orden de las columnas:</span>
                <Link
                  href={idsHref(columnIds)}
                  aria-current={keepChosenOrder ? undefined : "true"}
                  className={cn(buttonVariants({ variant: keepChosenOrder ? "outline" : "secondary", size: "sm" }))}
                >
                  Mejor opción
                </Link>
                <Link
                  href={idsHref(chosenIds, { orden: "elegido" })}
                  aria-current={keepChosenOrder ? "true" : undefined}
                  className={cn(buttonVariants({ variant: keepChosenOrder ? "secondary" : "outline", size: "sm" }))}
                >
                  En el orden elegido
                </Link>
              </>
            )}
          </div>
          <ComparisonTable
            candidates={columns}
            requirements={requirements}
            rankOf={rankOf}
            removeHref={removeHref}
            canSchedule={can(user.role, "applications:manage") && vacancy.status !== "archivada"}
          />
        </>
      )}
    </div>
  );
}
