import { listActivePublications } from "@/modules/portal-bot/publications";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return listActivePublications(request);
}
