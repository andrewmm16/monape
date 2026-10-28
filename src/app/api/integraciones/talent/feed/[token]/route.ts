import { logServerError } from "@/lib/errors";
import { getTalentApplyConfig } from "@/modules/integrations/talent-apply/config";
import { isValidFeedToken, talentApplyPostPath, talentApplyToken } from "@/modules/integrations/talent-apply/token";
import { buildFeedXml } from "@/modules/public-jobs/feed";
import { listPublicVacancies } from "@/modules/public-jobs/queries";

// El feed depende de la base de datos y de variables de entorno: nunca se prerenderiza.
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

/**
 * Feed para Talent.com: el mismo de /empleos/feed.xml más el
 * `<talent-apply-data>` de cada vacante. El token de la URL es secreto.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const config = getTalentApplyConfig();
    if (!config.enabled || !isValidFeedToken(config.feedToken, token)) {
      return new Response("No encontrado", { status: 404, headers: HEADERS });
    }

    const { siteUrl } = config.site;
    const xml = buildFeedXml(await listPublicVacancies(), config.site, new Date(), {
      talentApplyPostUrl: (vacancy) => `${siteUrl}${talentApplyPostPath(vacancy.code, talentApplyToken(config.secret, vacancy.code))}`,
    });
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", ...HEADERS } });
  } catch (error) {
    // Configuración incompleta o fallo de la base de datos: sin detalles en la respuesta.
    logServerError("talent_apply.feed", error);
    return new Response(null, { status: 500, headers: HEADERS });
  }
}
