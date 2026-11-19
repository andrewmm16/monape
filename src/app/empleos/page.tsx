import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { EMPLOYMENT_TYPE_LABELS, WORK_MODALITY_LABELS } from "@/lib/labels";
import { getPublicJobsConfig, requirePublicJobsConfig } from "@/modules/public-jobs/config";
import { listPublicVacancies } from "@/modules/public-jobs/queries";
import { jobPath } from "@/modules/public-jobs/slug";

export async function generateMetadata(): Promise<Metadata> {
  const config = getPublicJobsConfig();
  if (!config.enabled) return {};
  return { title: "Vacantes abiertas", alternates: { canonical: `${config.siteUrl}/empleos` } };
}

export default async function PublicJobsPage() {
  requirePublicJobsConfig();
  const vacancies = await listPublicVacancies();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Vacantes abiertas</h1>
      {vacancies.length === 0 ? (
        <EmptyState title="No hay vacantes abiertas por ahora" description="Vuelva a consultar más adelante." />
      ) : (
        <ul className="space-y-3">
          {vacancies.map((vacancy) => (
            <li key={vacancy.code}>
              <Card className="relative transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/50">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-3">
                    <h2>
                      {/* Enlace extendido: toda la tarjeta se puede tocar. */}
                      <Link href={jobPath(vacancy.title, vacancy.code)} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
                        {vacancy.title}
                      </Link>
                    </h2>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>{vacancy.department}</span>
                  {vacancy.city ? <span>{[vacancy.city, vacancy.region].filter(Boolean).join(", ")}</span> : null}
                  {vacancy.modality ? <span>{WORK_MODALITY_LABELS[vacancy.modality]}</span> : null}
                  <span>{EMPLOYMENT_TYPE_LABELS[vacancy.employmentType]}</span>
                  <span>Publicada el {formatDate(vacancy.firstPublishedAt)}</span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
