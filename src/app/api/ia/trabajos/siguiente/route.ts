import { claimAiJob } from "@/modules/evaluation/ai-worker-api";

// Depende de la base de datos y de variables de entorno: nunca se prerenderiza.
export const dynamic = "force-dynamic";

/** API del worker de IA; la barrera es `Authorization: Bearer <AI_WORKER_SECRET>`. */
export async function POST(request: Request) {
  return claimAiJob(request);
}
