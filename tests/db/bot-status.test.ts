import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createTestDatabase, createUser, expectError, user } from "./harness";

/** Estado del robot: solo el robot (service_role) lo escribe; solo el personal lo lee. */
let db: PGlite;
let rrhh: string;
let portalId: string;
let manualPortalId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  portalId = (await db.query<{ id: string }>("select id from public.job_portals where name = 'Trabajos Diarios'")).rows[0]!.id;
  manualPortalId = (await db.query<{ id: string }>("select id from public.job_portals where name = 'Bumeran'")).rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const report = (portal: string, state: string, reason: string | null = null) =>
  asService(() => db.query("select public.bot_report_status($1, $2, $3)", [portal, state, reason]));

const current = () =>
  db.query<{ state: string; reason: string | null }>("select state, reason from public.bot_status where portal_id = $1", [portalId]);

describe("bot_report_status", () => {
  it("guarda el estado y lo actualiza en la misma fila", async () => {
    await report(portalId, "necesita_persona", "verificacion_requerida");
    expect((await current()).rows).toEqual([{ state: "necesita_persona", reason: "verificacion_requerida" }]);

    await report(portalId, "activo", "ignorada");
    expect((await current()).rows).toEqual([{ state: "activo", reason: null }]);
    expect((await db.query("select 1 from public.bot_status where portal_id = $1", [portalId])).rows).toHaveLength(1);
  });

  it("rechaza estados y causas inválidos y portales que el robot no atiende", async () => {
    expect(await expectError(report(portalId, "roto"))).toMatchObject({ code: "RH422" });
    expect(await expectError(report(portalId, "necesita_persona", "Texto libre"))).toMatchObject({ code: "RH422" });
    expect(await expectError(report(manualPortalId, "activo"))).toMatchObject({ code: "RH404" });
  });

  it("el personal puede leer el estado pero no escribirlo ni llamar a la función", async () => {
    await asActor(db, user(rrhh), async () => {
      expect((await db.query("select * from public.bot_status")).rows.length).toBeGreaterThan(0);
      await expectError(db.query("update public.bot_status set state = 'activo'"));
      await expectError(db.query("select public.bot_report_status($1, 'activo', null)", [portalId]));
    });
  });
});
