import { markPublicationSynced } from "@/modules/portal-bot/publications";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return markPublicationSynced(request, id);
}
