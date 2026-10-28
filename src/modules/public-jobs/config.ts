import "server-only";
import { notFound } from "next/navigation";
import { getServerEnv } from "@/lib/env";
import type { PublicSiteContext } from "./types";

export type PublicJobsConfig = ({ enabled: true } & PublicSiteContext) | { enabled: false };

/** Configuración de la parte pública. Apagada por defecto. */
export function getPublicJobsConfig(): PublicJobsConfig {
  const env = getServerEnv();
  // El esquema ya exige URL y empresa cuando está encendida.
  if (!env.PUBLIC_JOBS_ENABLED || !env.PUBLIC_SITE_URL || !env.PUBLIC_COMPANY_NAME) return { enabled: false };
  return {
    enabled: true,
    siteUrl: env.PUBLIC_SITE_URL.replace(/\/+$/, ""),
    companyName: env.PUBLIC_COMPANY_NAME,
    companyWebsite: env.PUBLIC_COMPANY_WEBSITE,
    companyLogoUrl: env.PUBLIC_COMPANY_LOGO_URL,
  };
}

/** Configuración encendida o 404: toda la parte pública responde 404 si está apagada. */
export function requirePublicJobsConfig(): PublicSiteContext {
  const config = getPublicJobsConfig();
  if (!config.enabled) notFound();
  return config;
}
