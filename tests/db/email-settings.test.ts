import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createTestDatabase, createUser, expectError, user } from "./harness";

/**
 * Correo de respuestas (email_settings) y plantilla editable de la invitación
 * de la base de talentos (clave 'invitacion_cartera' en email_templates).
 */
let db: PGlite;
let rrhh: string;
let caleta: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH");
  caleta = await createUser(db, "reclutador_caleta", "Caleta");
});

afterAll(async () => {
  await db.close();
});

describe("email_settings", () => {
  it("el personal guarda el correo de respuestas y queda quién lo cambió", async () => {
    await asActor(db, user(rrhh), () => db.query("insert into public.email_settings (reply_to) values ('rrhh@empresa.pe')"));
    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ reply_to: string; updated_by: string }>("select reply_to, updated_by from public.email_settings"),
    );
    expect(rows).toEqual([{ reply_to: "rrhh@empresa.pe", updated_by: rrhh }]);
  });

  it("es una sola fila: no admite una segunda", async () => {
    const error = await expectError(
      asActor(db, user(rrhh), () => db.query("insert into public.email_settings (reply_to) values ('otra@empresa.pe')")),
    );
    expect(error.message).toMatch(/duplicate|unique|duplicad/i);
  });

  it("rechaza una dirección que no es un correo", async () => {
    const error = await expectError(
      asActor(db, user(rrhh), () => db.query("update public.email_settings set reply_to = 'no es un correo'")),
    );
    expect(error.message).toMatch(/check/i);
  });

  it("un usuario sin rol de RRHH no la ve ni la cambia", async () => {
    const seen = await asActor(db, user(caleta), () => db.query("select reply_to from public.email_settings"));
    expect(seen.rows).toHaveLength(0);
    const updated = await asActor(db, user(caleta), () =>
      db.query("update public.email_settings set reply_to = 'intruso@x.pe' returning reply_to"),
    );
    expect(updated.rows).toHaveLength(0);
  });
});

describe("plantilla de invitación", () => {
  it("email_templates acepta la clave de la invitación de la base de talentos", async () => {
    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ key: string }>(
        "insert into public.email_templates (key, subject, body) values ('invitacion_cartera', 'Hola', 'Texto') returning key",
      ),
    );
    expect(rows[0]!.key).toBe("invitacion_cartera");
  });
});
