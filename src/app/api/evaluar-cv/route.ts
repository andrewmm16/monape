import { handleEvaluateWebhook } from "@/modules/evaluation/webhook";

// Depende de la base de datos y de variables de entorno: nunca se prerenderiza.
export const dynamic = "force-dynamic";

/**
 * Webhook interno de evaluación de CV. Pública y sin cookies (ver src/proxy.ts);
 * la barrera es el secreto `Authorization: Bearer <EVALUATION_WEBHOOK_SECRET>`.
 */
export async function POST(request: Request) {
  return handleEvaluateWebhook(request);
}
