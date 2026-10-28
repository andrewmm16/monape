import type { MetadataRoute } from "next";
import { getPublicJobsConfig } from "@/modules/public-jobs/config";
import { listPublicVacancies } from "@/modules/public-jobs/queries";
import { jobPath } from "@/modules/public-jobs/slug";

// Depende de la base de datos y de variables de entorno: se evalúa en cada solicitud.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const config = getPublicJobsConfig();
  if (!config.enabled) return [];
  const vacancies = await listPublicVacancies();
  return [
    { url: `${config.siteUrl}/empleos`, lastModified: new Date() },
    ...vacancies.map((vacancy) => ({
      url: `${config.siteUrl}${jobPath(vacancy.title, vacancy.code)}`,
      lastModified: new Date(vacancy.updatedAt),
    })),
  ];
}
