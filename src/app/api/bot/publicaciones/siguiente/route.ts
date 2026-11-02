import { claimNextPublication } from "@/modules/portal-bot/publications";

// Depende de la base de datos y de variables de entorno: nunca se prerenderiza.
export const dynamic = "force-dynamic";

/** API del robot de portales; la barrera es `Authorization: Bearer <PORTAL_BOT_SECRET>`. */
export async function POST(request: Request) {
  return claimNextPublication(request);
}
