import { reportBotStatus } from "@/modules/portal-bot/status";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return reportBotStatus(request);
}
