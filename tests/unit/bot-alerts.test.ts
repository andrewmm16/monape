import { describe, expect, it } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { BOT_SILENCE_MINUTES, listBotAlerts } from "@/modules/portals/queries";

const NOW = new Date("2026-10-29T15:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function clientWith(rows: unknown[], error: unknown = null) {
  return {
    from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }),
  } as unknown as AppSupabaseClient;
}

const row = (state: string, reason: string | null, seenMinutesAgo: number) => ({
  state,
  reason,
  seen_at: minutesAgo(seenMinutesAgo),
  portal: { name: "Trabajos Diarios" },
});

describe("avisos del robot para RRHH", () => {
  it("un robot activo y reciente no genera aviso", async () => {
    expect(await listBotAlerts(clientWith([row("activo", null, 2)]), NOW)).toEqual([]);
  });

  it("un robot que no se ha conectado nunca no genera aviso", async () => {
    expect(await listBotAlerts(clientWith([]), NOW)).toEqual([]);
  });

  it("avisa que necesita a una persona, con la causa, sin importar cuándo fue", async () => {
    const alerts = await listBotAlerts(clientWith([row("necesita_persona", "verificacion_requerida", 600)]), NOW);
    expect(alerts).toEqual([
      { portalName: "Trabajos Diarios", kind: "necesita_persona", reason: "verificacion_requerida", seenAt: minutesAgo(600) },
    ]);
  });

  it("avisa cuando el robot lleva demasiado tiempo sin dar señales", async () => {
    const quiet = await listBotAlerts(clientWith([row("activo", null, BOT_SILENCE_MINUTES - 1)]), NOW);
    expect(quiet).toEqual([]);
    const silent = await listBotAlerts(clientWith([row("activo", null, BOT_SILENCE_MINUTES + 1)]), NOW);
    expect(silent).toMatchObject([{ portalName: "Trabajos Diarios", kind: "sin_senal" }]);
  });

  it("propaga el error de la base de datos", async () => {
    await expect(listBotAlerts(clientWith([], { code: "XX000", message: "falló" }), NOW)).rejects.toBeDefined();
  });
});
