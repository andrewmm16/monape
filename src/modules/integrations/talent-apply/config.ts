import "server-only";
import { getServerEnv } from "@/lib/env";
import type { PublicSiteContext } from "@/modules/public-jobs/types";

export type TalentApplyConfig =
  | { enabled: false }
  | { enabled: true; secret: string; feedToken: string; site: PublicSiteContext };

/**
 * Configuración de la recepción de Talent Apply. Apagada por defecto: todas las
 * rutas responden 404. El esquema de entorno ya exige secretos, URL y empresa
 * cuando está encendida.
 */
export function getTalentApplyConfig(): TalentApplyConfig {
  const env = getServerEnv();
  if (
    !env.TALENT_APPLY_ENABLED ||
    !env.TALENT_APPLY_SECRET ||
    !env.TALENT_FEED_TOKEN ||
    !env.PUBLIC_SITE_URL ||
    !env.PUBLIC_COMPANY_NAME
  ) {
    return { enabled: false };
  }
  return {
    enabled: true,
    secret: env.TALENT_APPLY_SECRET,
    feedToken: env.TALENT_FEED_TOKEN,
    site: {
      siteUrl: env.PUBLIC_SITE_URL.replace(/\/+$/, ""),
      companyName: env.PUBLIC_COMPANY_NAME,
      companyWebsite: env.PUBLIC_COMPANY_WEBSITE,
      companyLogoUrl: env.PUBLIC_COMPANY_LOGO_URL,
    },
  };
}
