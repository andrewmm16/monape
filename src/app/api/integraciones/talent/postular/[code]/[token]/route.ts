import { receiveTalentApply } from "@/modules/integrations/talent-apply/receive";

// Depende de la base de datos y de variables de entorno: nunca se prerenderiza.
export const dynamic = "force-dynamic";

/**
 * Recepción de Talent Apply. Pública y sin cookies (ver src/proxy.ts); la única
 * barrera es el token de la URL, derivado del código de la vacante.
 */
export async function POST(request: Request, context: { params: Promise<{ code: string; token: string }> }) {
  const { code, token } = await context.params;
  return receiveTalentApply(request, code, token);
}
