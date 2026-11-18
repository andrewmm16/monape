import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { anon, asActor, createTestDatabase, createUser, expectError, user } from "./harness";

/** Vigilancia semanal de la IA (20261118200200): la escribe el sistema y la lee administración. */
let db: PGlite;
let rrhh: string;
let admin: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  admin = await createUser(db, "admin", "Admin Ficticio");
  await db.exec("set role service_role");
  try {
    await db.query(
      `insert into public.ai_quality_checks
         (model, prompt_version, cv_count, failures, order_inversions, cells, accuracy_engine, accuracy_ai,
          accuracy_relay, accuracy_relay_lenient, ai_over_accredited, seconds_per_cv, status, reasons)
       values ('claude-haiku-5-5', 'ia-prompt-v5', 32, 0, 1, 248, 0.9597, 0.8911, 0.9718, 0.9718, 1, 17.4, 'ok', '{}')`,
    );
  } finally {
    await db.exec("reset role");
  }
});

afterAll(async () => {
  await db?.close();
});

const read = () => db.query<{ status: string }>("select status from public.ai_quality_checks");

describe("ai_quality_checks", () => {
  it("administración la lee; RRHH y anónimos no ven nada", async () => {
    expect((await asActor(db, user(admin), read)).rows).toEqual([{ status: "ok" }]);
    expect((await asActor(db, user(rrhh), read)).rows).toEqual([]);
    // Anónimos no tienen ni el permiso de lectura de la tabla.
    await expectError(asActor(db, anon, read));
  });

  it("nadie con sesión puede registrar ni cambiar revisiones (solo el sistema)", async () => {
    await expectError(
      asActor(db, user(admin), () =>
        db.query("insert into public.ai_quality_checks (model, prompt_version, cv_count, failures, cells, ai_over_accredited, status) values ('x', 'v', 0, 0, 0, 0, 'ok')"),
      ),
    );
    await expectError(asActor(db, user(admin), () => db.query("update public.ai_quality_checks set status = 'alerta'")));
  });

  it("valida los valores (estado y aciertos entre 0 y 1)", async () => {
    await db.exec("set role service_role");
    try {
      await expectError(
        db.query("insert into public.ai_quality_checks (model, prompt_version, cv_count, failures, cells, ai_over_accredited, status) values ('x', 'v', 0, 0, 0, 0, 'regular')"),
      );
      await expectError(
        db.query(
          "insert into public.ai_quality_checks (model, prompt_version, cv_count, failures, cells, ai_over_accredited, status, accuracy_ai) values ('x', 'v', 0, 0, 0, 0, 'ok', 1.5)",
        ),
      );
    } finally {
      await db.exec("reset role");
    }
  });
});
