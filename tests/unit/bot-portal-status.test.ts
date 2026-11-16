import { describe, expect, it } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { BOT_SILENCE_MINUTES, listBotPortalStatuses } from "@/modules/portals/queries";

const NOW = new Date("2026-11-06T15:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

/** Cliente falso: cualquier cadena de filtros resuelve a estas filas. */
function clientWith(rows: unknown[], error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) builder[method] = () => builder;
  builder.then = (resolve: (value: { data: unknown[]; error: unknown }) => unknown) =>
    resolve({ data: rows, error });
  return { from: () => builder } as unknown as AppSupabaseClient;
}

const portal = (name: string, status: { state: string; reason: string | null; seenMinutesAgo: number } | null) => ({
  name,
  bot_status: status ? { state: status.state, reason: status.reason, seen_at: minutesAgo(status.seenMinutesAgo) } : null,
});

describe("estado de cada portal para el semáforo", () => {
  it("un portal activo y con señal reciente está «ok»", async () => {
    const [estado] = await listBotPortalStatuses(clientWith([portal("Trabajos Diarios", { state: "activo", reason: null, seenMinutesAgo: 2 })]), NOW);
    expect(estado).toMatchObject({ portalName: "Trabajos Diarios", nivel: "ok", reason: null });
  });

  it("un portal activo sin señal reciente pasa a «atencion» con motivo sin_senal", async () => {
    const [estado] = await listBotPortalStatuses(clientWith([portal("Indeed", { state: "activo", reason: null, seenMinutesAgo: BOT_SILENCE_MINUTES + 1 })]), NOW);
    expect(estado).toMatchObject({ portalName: "Indeed", nivel: "atencion", reason: "sin_senal" });
  });

  it("una causa que resuelve la persona (sesión vencida) es «atencion»", async () => {
    const [estado] = await listBotPortalStatuses(clientWith([portal("Bumeran", { state: "necesita_persona", reason: "sesion_expirada", seenMinutesAgo: 30 })]), NOW);
    expect(estado).toMatchObject({ portalName: "Bumeran", nivel: "atencion", reason: "sesion_expirada" });
  });

  it("un cambio del portal (pagina_cambio) es «error»: necesita al técnico", async () => {
    const [estado] = await listBotPortalStatuses(clientWith([portal("Computrabajo", { state: "necesita_persona", reason: "pagina_cambio", seenMinutesAgo: 30 })]), NOW);
    expect(estado).toMatchObject({ portalName: "Computrabajo", nivel: "error", reason: "pagina_cambio" });
  });

  it("un portal sin ninguna señal todavía es «sin_datos»", async () => {
    const [estado] = await listBotPortalStatuses(clientWith([portal("LinkedIn", null)]), NOW);
    expect(estado).toMatchObject({ portalName: "LinkedIn", nivel: "sin_datos", reason: null, seenAt: null });
  });

  it("acepta el embebido como arreglo (PostgREST a-uno) y conserva el orden", async () => {
    const rows = [
      { name: "Uno", bot_status: [{ state: "activo", reason: null, seen_at: minutesAgo(1) }] },
      { name: "Dos", bot_status: [] },
    ];
    const estados = await listBotPortalStatuses(clientWith(rows), NOW);
    expect(estados.map((e) => e.portalName)).toEqual(["Uno", "Dos"]);
    expect(estados[0].nivel).toBe("ok");
    expect(estados[1].nivel).toBe("sin_datos");
  });

  it("propaga el error de la base de datos", async () => {
    await expect(listBotPortalStatuses(clientWith([], { code: "XX000", message: "falló" }), NOW)).rejects.toBeDefined();
  });
});
