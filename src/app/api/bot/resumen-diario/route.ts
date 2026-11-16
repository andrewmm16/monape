import { botDailySummary } from "@/modules/portal-bot/daily-summary";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return botDailySummary(request);
}
