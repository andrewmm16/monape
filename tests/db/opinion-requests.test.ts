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

let db: PGlite;
let admin: string;
let rrhh: string;
let consultada: string;
let otraPersona: string;
let inactiva: string;
let vacancyId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin Ficticio");
  rrhh = await createUser(db, "rrhh", "RRHH Ficticia");
  consultada = await createUser(db, "rrhh", "Persona Consultada");
  otraPersona = await createUser(db, "rrhh", "Otra Persona");
  inactiva = await createUser(db, "rrhh", "Persona Inactiva");
  await db.query("update public.profiles set is_active = false where id = $1", [inactiva]);
  vacancyId = await createVacancy(db);
});

afterAll(async () => {
  await db?.close();
});

const ask = (applicationId: string, profileId: string | null, actor = rrhh) =>
  asActor(db, user(actor), () => db.query("select public.request_opinion($1, $2)", [applicationId, profileId]));

const observe = (applicationId: string, actor: string) =>
  asActor(db, user(actor), () =>
    db.query("insert into public.application_events (application_id, event_type, note) values ($1, 'observacion', 'Mi opinión')", [
      applicationId,
    ]),
  );

const notificationsOf = (profileId: string) =>
  asActor(db, user(profileId), async () => {
    const { rows } = await db.query<{ kind: string; application_id: string; actor_id: string; read_at: string | null }>(
      "select kind, application_id, actor_id, read_at from public.notifications order by id",
    );
    return rows;
  });

async function opinionOf(applicationId: string) {
  const { rows } = await db.query<{
    assigned_evaluator_id: string | null;
    opinion_requested_by: string | null;
    opinion_requested_at: string | null;
    opinion_answered_at: string | null;
  }>(
    "select assigned_evaluator_id, opinion_requested_by, opinion_requested_at, opinion_answered_at from public.applications where id = $1",
    [applicationId],
  );
  return rows[0]!;
}

describe("pedir opinión", () => {
  it("notifica a la persona consultada y, cuando responde con una observación, a quien la pidió", async () => {
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    await ask(applicationId, consultada);

    expect(await opinionOf(applicationId)).toMatchObject({ assigned_evaluator_id: consultada, opinion_requested_by: rrhh, opinion_answered_at: null });
    expect(await notificationsOf(consultada)).toEqual([
      { kind: "opinion_solicitada", application_id: applicationId, actor_id: rrhh, read_at: null },
    ]);

    // Una observación de otra persona no responde la solicitud.
    await observe(applicationId, otraPersona);
    expect((await opinionOf(applicationId)).opinion_answered_at).toBeNull();

    await observe(applicationId, consultada);
    expect((await opinionOf(applicationId)).opinion_answered_at).not.toBeNull();
    expect((await notificationsOf(consultada))[0]!.read_at).not.toBeNull();
    expect(await notificationsOf(rrhh)).toEqual([
      { kind: "opinion_respondida", application_id: applicationId, actor_id: consultada, read_at: null },
    ]);
  });

  it("cambiar de persona o retirar la solicitud quita la notificación sin leer", async () => {
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    await ask(applicationId, consultada);
    await ask(applicationId, otraPersona);
    expect((await notificationsOf(consultada)).filter((n) => n.application_id === applicationId)).toEqual([]);
    expect((await notificationsOf(otraPersona)).filter((n) => n.application_id === applicationId)).toHaveLength(1);

    await ask(applicationId, null);
    expect(await opinionOf(applicationId)).toEqual({
      assigned_evaluator_id: null,
      opinion_requested_by: null,
      opinion_requested_at: null,
      opinion_answered_at: null,
    });
    expect((await notificationsOf(otraPersona)).filter((n) => n.application_id === applicationId)).toEqual([]);
  });

  it("solo una cuenta activa pide opinión, a otra persona activa y nunca la propia; la columna no se escribe directamente", async () => {
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    expect((await expectError(ask(applicationId, consultada, inactiva))).message).toMatch(/No autorizado/);
    expect((await expectError(ask(applicationId, inactiva))).message).toMatch(/cuenta activa/);
    expect((await expectError(ask(applicationId, rrhh))).message).toMatch(/propia opinión/);
    const direct = await asActor(db, user(rrhh), () =>
      expectError(db.query("update public.applications set assigned_evaluator_id = $2 where id = $1", [applicationId, consultada])),
    );
    expect(direct.message).toMatch(/permission denied/);
  });
});

describe("notificaciones", () => {
  it("solo la persona consultada ve su notificación: ni quien la pidió, ni administración, ni otras personas", async () => {
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    await ask(applicationId, consultada);

    const visibleTo = async (profileId: string) =>
      (await notificationsOf(profileId)).filter((n) => n.application_id === applicationId && n.kind === "opinion_solicitada");
    expect(await visibleTo(consultada)).toHaveLength(1);
    for (const other of [rrhh, admin, otraPersona]) {
      expect(await visibleTo(other)).toEqual([]);
    }

    // Una cuenta desactivada tampoco puede leer las suyas.
    await db.query("update public.profiles set is_active = false where id = $1", [consultada]);
    expect(await visibleTo(consultada)).toEqual([]);
    await db.query("update public.profiles set is_active = true where id = $1", [consultada]);
  });

  it("cada persona marca como leídas solo las suyas y nadie las crea directamente", async () => {
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    await ask(applicationId, consultada);

    const others = await asActor(db, user(otraPersona), () =>
      db.query("update public.notifications set read_at = now() where application_id = $1", [applicationId]),
    );
    expect(others.affectedRows).toBe(0);

    const own = await asActor(db, user(consultada), () =>
      db.query("update public.notifications set read_at = now() where application_id = $1 and read_at is null", [applicationId]),
    );
    expect(own.affectedRows).toBe(1);

    const forged = await asActor(db, user(consultada), () =>
      expectError(
        db.query("insert into public.notifications (recipient_id, kind, application_id) values ($1, 'opinion_solicitada', $2)", [
          rrhh,
          applicationId,
        ]),
      ),
    );
    expect(forged.message).toMatch(/permission denied/);
  });
});
