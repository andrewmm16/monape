import "server-only";
import { getServerEnv } from "@/lib/env";

export type OnlineApplyConfig = { enabled: false } | { enabled: true; secret: string };

/**
 * Configuración del formulario público de postulación. Apagado por defecto. El
 * esquema de entorno ya exige la parte pública y el secreto cuando está encendido.
 */
export function getOnlineApplyConfig(): OnlineApplyConfig {
  const env = getServerEnv();
  if (!env.PUBLIC_APPLY_ENABLED || !env.PUBLIC_JOBS_ENABLED || !env.INTAKE_HASH_SECRET) return { enabled: false };
  return { enabled: true, secret: env.INTAKE_HASH_SECRET };
}
