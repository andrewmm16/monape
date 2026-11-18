import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asActor,
  createApplication,
  createCandidate,
  createTestDatabase,
  createUser,
  createVacancy,
  expectError,
  user,
} from "./harness";

/** Portal del candidato: enlace de seguimiento estable y estado público (apagado por defecto). */
let db: PGlite;
let admin: string;
let rrhh: string;
let applicationId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin");
  rrhh = await createUser(db, "rrhh", "RRHH");
  applicationId = await createApplication(db, await createCandidate(db), await createVacancy(db, { title: "Analista de Datos" }));
});

afterAll(async () => {
  await db.close();
});

/** Como la clave de servicio de Supabase (rol y JWT `service_role`). */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "service_role" })]);
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

const link = (actor: string, renew = false) =>
  asActor(db, user(actor), () =>
    db.query<{ token: string }>("select public.get_application_tracking_link($1, $2) as token", [applicationId, renew]),
  ).then((r) => r.rows[0]!.token);

const status = (token: string) =>
  asService(() => db.query<{ status: Record<string, unknown> | null }>("select public.public_application_status($1) as status", [token])).then(
    (r) => r.rows[0]!.status,
  );

const setEnabled = (actor: string, enabled: boolean) =>
  asActor(db, user(actor), () => db.query("update public.candidate_portal_settings set enabled = $1 where id", [enabled]));

describe("portal del candidato", () => {
  it("apagado por defecto: el enlace no muestra nada", async () => {
    const token = await link(rrhh);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await status(token)).toBeNull();
  });

  it("el enlace es estable (el mismo en cada correo) y renovarlo anula el anterior", async () => {
    await setEnabled(admin, true);
    const first = await link(rrhh);
    expect(await link(rrhh)).toBe(first);
    const shown = await status(first);
    expect(shown).toMatchObject({ vacancy_title: "Analista de Datos", stage: "recibida", next_interview: null });
    expect(Object.keys(shown!).sort()).toEqual(["applied_at", "next_interview", "stage", "updated_at", "vacancy_title"]);

    await asActor(db, user(rrhh), () =>
      db.query("select public.schedule_interview($1, now() + interval '2 days', 45, 'virtual', 'https://meet.example/z')", [applicationId]),
    );
    const withInterview = await status(first);
    expect(withInterview).toMatchObject({ stage: "entrevista" });
    expect(withInterview!.next_interview).toMatchObject({ modality: "virtual", location: "https://meet.example/z" });

    const renewed = await link(rrhh, true);
    expect(renewed).not.toBe(first);
    expect(await status(first)).toBeNull();
    expect(await status(renewed)).not.toBeNull();
    expect(await status("no-es-un-token")).toBeNull();

    const { rows } = await db.query<{ action: string }>(
      "select action from public.audit_logs where entity_id = $1 and action like 'enlace_seguimiento_%' order by id",
      [applicationId],
    );
    expect(rows.map((row) => row.action)).toEqual(["enlace_seguimiento_creado", "enlace_seguimiento_renovado"]);
  });

  it("la clave de servicio obtiene el enlace (acuse del formulario público)", async () => {
    const { rows } = await asService(() =>
      db.query<{ token: string }>("select public.get_application_tracking_link($1) as token", [applicationId]),
    );
    expect(rows[0]!.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("permisos: RRHH no enciende el portal; solo el servidor lee el estado público; anon no obtiene enlaces", async () => {
    await setEnabled(rrhh, false);
    const { rows } = await db.query<{ enabled: boolean }>("select enabled from public.candidate_portal_settings");
    expect(rows[0]!.enabled).toBe(true); // la RLS no dejó cambiarlo
    await expectError(asActor(db, user(rrhh), () => db.query("select public.public_application_status('x')")));
    await expectError(asActor(db, user(rrhh), () => db.query("select * from public.application_tracking_tokens")));
    const caleta = await createUser(db, "reclutador_caleta", "Caleta");
    await expectError(link(caleta));
  });
});
