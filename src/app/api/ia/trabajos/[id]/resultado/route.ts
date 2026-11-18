import { reportAiJob } from "@/modules/evaluation/ai-worker-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return reportAiJob(request, id);
}
