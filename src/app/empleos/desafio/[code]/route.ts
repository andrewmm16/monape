import { issueChallenge, isVacancyCode } from "@/modules/online-apply/challenge";
import { getOnlineApplyConfig } from "@/modules/online-apply/config";

// El desafío depende de la hora y de un nonce: nunca se prerenderiza ni se cachea.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** GET /empleos/desafio/<código de vacante>: desafío firmado de la prueba de trabajo. */
export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const config = getOnlineApplyConfig();
  const { code } = await context.params;
  if (!config.enabled || !isVacancyCode(code)) return new Response(null, { status: 404, headers: NO_STORE });
  return Response.json(issueChallenge(config.secret, code), { headers: NO_STORE });
}
