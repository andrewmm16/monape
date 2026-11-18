import { reportAiWorkerStatus } from "@/modules/evaluation/ai-worker-api";

export const dynamic = "force-dynamic";

/** Latido y estado del worker de IA; la barrera es `Authorization: Bearer <AI_WORKER_SECRET>`. */
export async function POST(request: Request) {
  return reportAiWorkerStatus(request);
}
