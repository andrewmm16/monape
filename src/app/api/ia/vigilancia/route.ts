import { reportAiQualityCheck } from "@/modules/evaluation/ai-worker-api";

export const dynamic = "force-dynamic";

/** Resumen de la vigilancia semanal de la IA; la barrera es `Authorization: Bearer <AI_WORKER_SECRET>`. */
export async function POST(request: Request) {
  return reportAiQualityCheck(request);
}
