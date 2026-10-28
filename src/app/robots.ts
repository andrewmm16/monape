import type { MetadataRoute } from "next";
import { getPublicJobsConfig } from "@/modules/public-jobs/config";

// Depende de variables de entorno: se evalúa en cada solicitud.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const config = getPublicJobsConfig();
  if (!config.enabled) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: ["/empleos", "/_next/static/"], disallow: "/" },
    sitemap: `${config.siteUrl}/sitemap.xml`,
  };
}
