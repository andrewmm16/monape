import { describe, expect, it } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { getBotDailySummary, startOfDayLima } from "@/modules/portals/daily-summary";

/** Cliente falso: cada tabla resuelve a sus propias filas sin importar los filtros encadenados. */
function clientWith(byTable: Record<string, { data?: unknown[]; error?: unknown }>) {
  return {
    from: (table: string) => {
      const result = byTable[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "gte"]) builder[method] = () => builder;
      builder.then = (resolve: (value: { data: unknown[]; error: unknown }) => unknown) =>
        resolve({ data: result.data ?? [], error: result.error ?? null });
      return builder;
    },
  } as unknown as AppSupabaseClient;
}

describe("inicio del día en hora de Perú", () => {
  it("devuelve la medianoche de Lima (UTC-5) del día local", () => {
    // 02:00 UTC = 21:00 del día anterior en Lima; el día local es el 5.
    expect(startOfDayLima(new Date("2026-11-06T02:00:00Z"))).toBe("2026-11-05T05:00:00.000Z");
  });

  it("a media tarde UTC sigue siendo el mismo día en Lima", () => {
    expect(startOfDayLima(new Date("2026-11-06T18:00:00Z"))).toBe("2026-11-06T05:00:00.000Z");
  });
});

describe("resumen del día del robot", () => {
  it("cuenta vacantes distintas publicadas y postulantes recibidos hoy", async () => {
    const supabase = clientWith({
      portal_publications: { data: [{ vacancy_id: "a" }, { vacancy_id: "a" }, { vacancy_id: "b" }] },
      integration_submissions: { data: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }] },
    });
    expect(await getBotDailySummary(supabase)).toEqual({ publishedToday: 2, applicantsToday: 4 });
  });

  it("sin actividad devuelve ceros", async () => {
    expect(await getBotDailySummary(clientWith({}))).toEqual({ publishedToday: 0, applicantsToday: 0 });
  });

  it("propaga el error de las publicaciones", async () => {
    const supabase = clientWith({ portal_publications: { error: { code: "XX000", message: "falló" } } });
    await expect(getBotDailySummary(supabase)).rejects.toBeDefined();
  });
});
