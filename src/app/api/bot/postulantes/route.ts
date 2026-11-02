import { receiveBotApplicant } from "@/modules/portal-bot/applicants";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return receiveBotApplicant(request);
}
