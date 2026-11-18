import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
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

/** Plazo de conservación: list_inactive_candidates y anonymize_candidate. */
let db: PGlite;
let admin: string;
let rrhh: string;
let vacancyId: string;
let oldClosed: string;
let oldClosedApp: string;
let oldInProcess: string;
let recent: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin");
  rrhh = await createUser(db, "rrhh", "RRHH");
  vacancyId = await createVacancy(db);

  // Candidato viejo con todo lo que se debe limpiar.
  oldClosed = await createCandidate(db, "Lucía Antigua Pérez");
  oldClosedApp = await createApplication(db, oldClosed, vacancyId);
  await db.query(
    `insert into public.resumes (candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
     values ($1, $2, 'cv.pdf', 'application/pdf', 1000, $3)`,
    [oldClosed, `candidates/${oldClosed}/${randomUUID()}.pdf`, "b".repeat(64)],
  );
  await db.query("insert into public.application_events (application_id, event_type, note) values ($1, 'observacion', 'Vive en Surco, DNI 12345678')", [
    oldClosedApp,
  ]);
  const { rows: tag } = await db.query<{ id: string }>(
    "insert into public.talent_tags (name, color, created_by) values ('Antiguos', 'orange', $1) returning id",
    [rrhh],
  );
  await db.query("insert into public.candidate_tags (candidate_id, tag_id, assigned_by) values ($1, $2, $3)", [oldClosed, tag[0]!.id, rrhh]);
  await asActor(db, user(rrhh), () =>
    db.query("select public.change_application_status($1, 'no_seleccionado', 'Perfil distinto')", [oldClosedApp]),
  );

  // Viejo, pero con una postulación en curso: no aparece ni se puede anonimizar.
  oldInProcess = await createCandidate(db, "Mario En Proceso");
  await createApplication(db, oldInProcess, vacancyId);

  recent = await createCandidate(db, "Ana Reciente");

  // Toda la actividad de los dos «viejos» pasa a hace 3 años (sin disparadores).
  await db.exec("set session_replication_role = replica");
  for (const id of [oldClosed, oldInProcess]) {
    await db.query("update public.candidates set updated_at = now() - interval '3 years' where id = $1", [id]);
    await db.query("update public.applications set updated_at = now() - interval '3 years' where candidate_id = $1", [id]);
    await db.query(
      `update public.application_events set created_at = now() - interval '3 years'
       where application_id in (select id from public.applications where candidate_id = $1)`,
      [id],
    );
  }
  await db.exec("set session_replication_role = origin");
});

afterAll(async () => {
  await db.close();
});

const inactive = (actor: string, months = 24) =>
  asActor(db, user(actor), () =>
    db.query<{ candidate_id: string; pool_consent: string; applications: number }>(
      "select * from public.list_inactive_candidates($1)",
      [months],
    ),
  );

const anonymize = (actor: string, id: string) =>
  asActor(db, user(actor), () => db.query("select public.anonymize_candidate($1)", [id]));

describe("list_inactive_candidates", () => {
  it("solo los inactivos sin postulación en curso, y solo para administración", async () => {
    const { rows } = await inactive(admin);
    expect(rows.map((row) => row.candidate_id)).toEqual([oldClosed]);
    expect(rows[0]).toMatchObject({ applications: 1, pool_consent: "sin" });
    await expectError(inactive(rrhh));
    const tooShort = await expectError(inactive(admin, 3));
    expect(tooShort.message).toMatch(/6 y 120/);
  });
});

describe("anonymize_candidate", () => {
  it("quita los datos personales y conserva la postulación", async () => {
    await expectError(anonymize(rrhh, oldClosed));
    await anonymize(admin, oldClosed);

    const { rows: candidate } = await db.query<Record<string, unknown>>(
      "select full_name, email, phone, anonymized_at from public.candidates where id = $1",
      [oldClosed],
    );
    expect(candidate[0]!.full_name).toMatch(/^Persona anonimizada /);
    expect(candidate[0]!).toMatchObject({ email: null, phone: null });
    expect(candidate[0]!.anonymized_at).not.toBeNull();

    const count = async (sql: string) => Number((await db.query<{ n: number }>(sql, [oldClosed])).rows[0]!.n);
    expect(await count("select count(*) as n from public.resumes where candidate_id = $1")).toBe(0);
    expect(await count("select count(*) as n from public.candidate_tags where candidate_id = $1")).toBe(0);
    expect(await count("select count(*) as n from public.applications where candidate_id = $1")).toBe(1);

    const { rows: notes } = await db.query<{ note: string | null; reason: string | null }>(
      `select e.note, e.reason from public.application_events e
       join public.applications a on a.id = e.application_id where a.candidate_id = $1`,
      [oldClosed],
    );
    for (const row of notes) {
      expect(row.note === null || row.note === "[anonimizado]").toBe(true);
      expect(row.reason).toBeNull();
    }

    const { rows: audit } = await db.query("select actor_id from public.audit_logs where action = 'candidato_anonimizado' and entity_id = $1", [
      oldClosed,
    ]);
    expect(audit).toEqual([{ actor_id: admin }]);
    expect((await inactive(admin)).rows).toEqual([]);
  });

  it("no se repite, no toca postulaciones en curso y no admite postular de nuevo", async () => {
    const again = await expectError(anonymize(admin, oldClosed));
    expect(again.message).toMatch(/ya está anonimizado/);
    const inProcess = await expectError(anonymize(admin, oldInProcess));
    expect(inProcess.message).toMatch(/en curso/);
    const reapply = await expectError(createApplication(db, oldClosed, await createVacancy(db, { title: "Otra" })));
    expect(reapply.message).toMatch(/anonimizada/);
    expect(recent).toBeTruthy();
  });
});
