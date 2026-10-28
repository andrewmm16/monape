import { getPublicJobsConfig } from "@/modules/public-jobs/config";
import { buildFeedXml } from "@/modules/public-jobs/feed";
import { listPublicVacancies } from "@/modules/public-jobs/queries";

// El feed depende de la base de datos y de variables de entorno: nunca se prerenderiza.
export const dynamic = "force-dynamic";

export async function GET() {
  const config = getPublicJobsConfig();
  if (!config.enabled) return new Response("No encontrado", { status: 404 });
  const xml = buildFeedXml(await listPublicVacancies(), config);
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
