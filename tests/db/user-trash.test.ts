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

// Base propia: la prueba del último administrador necesita que haya uno solo.
let db: PGlite;
let admin: string;
let rrhh: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin Ficticio");
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
});

afterAll(async () => {
  await db?.close();
});

const setActive = (profileId: string, isActive: boolean) =>
  asActor(db, user(admin), () =>
    db.query("update public.profiles set is_active = $2 where id = $1", [profileId, isActive]),
  );

async function getProfile(profileId: string) {
  const { rows } = await db.query<{
    full_name: string;
    email: string;
    is_active: boolean;
    deactivated_at: string | null;
    deleted_at: string | null;
  }>("select full_name, email, is_active, deactivated_at, deleted_at from public.profiles where id = $1", [profileId]);
  return rows[0];
}

describe("papelera de usuarios", () => {
  it("registra cuándo se desactiva un usuario y lo limpia al reactivarlo", async () => {
    const target = await createUser(db, "rrhh");
    await setActive(target, false);
    expect((await getProfile(target))!.deactivated_at).not.toBeNull();
    await setActive(target, true);
    expect((await getProfile(target))!.deactivated_at).toBeNull();
  });

  it("solo un administrador pide eliminar, solo usuarios de la papelera y nunca su propia cuenta", async () => {
    const target = await createUser(db, "rrhh");
    const request = (actor: string, profileId: string) =>
      asActor(db, user(actor), () => db.query("select public.log_user_deletion($1)", [profileId]));

    expect((await expectError(request(rrhh, target))).message).toMatch(/No autorizado/);
    expect((await expectError(request(admin, target))).message).toMatch(/papelera/);
    expect((await expectError(request(admin, admin))).message).toMatch(/propia cuenta/);

    await setActive(target, false);
    await request(admin, target);
    const { rows } = await db.query<{ actor_id: string; metadata: unknown }>(
      "select actor_id, metadata from public.audit_logs where action = 'delete_requested' and entity_id = $1",
      [target],
    );
    expect(rows).toEqual([{ actor_id: admin, metadata: { role: "rrhh" } }]);
  });

  it("al borrar la cuenta de Auth el perfil queda como registro histórico con su nombre", async () => {
    const target = await createUser(db, "rrhh", "Consultora Ficticia");
    const vacancyId = await createVacancy(db);
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    await db.query("update public.applications set assigned_evaluator_id = $2 where id = $1", [applicationId, target]);
    await asActor(db, user(target), () =>
      db.query(
        "insert into public.application_events (application_id, event_type, note) values ($1, 'observacion', 'Buen perfil')",
        [applicationId],
      ),
    );

    await setActive(target, false);
    await db.query("delete from auth.users where id = $1", [target]);

    const profile = await getProfile(target);
    expect(profile).toMatchObject({ full_name: "Consultora Ficticia (eliminado)", email: "", is_active: false });
    expect(profile!.deleted_at).not.toBeNull();

    // El historial conserva la autoría; las asignaciones vigentes se quitan.
    const events = await db.query("select 1 from public.application_events where actor_id = $1", [target]);
    expect(events.rows).toHaveLength(1);
    const assigned = await db.query<{ assigned_evaluator_id: string | null }>(
      "select assigned_evaluator_id from public.applications where id = $1",
      [applicationId],
    );
    expect(assigned.rows[0]!.assigned_evaluator_id).toBeNull();

    // Un perfil eliminado no se reactiva ni vuelve a pedirse su eliminación.
    expect((await expectError(setActive(target, true))).message).toMatch(/fue eliminado/);
    const again = await asActor(db, user(admin), () =>
      expectError(db.query("select public.log_user_deletion($1)", [target])),
    );
    expect(again.message).toMatch(/no encontrado/);
  });

  it("no se puede borrar la cuenta del único administrador activo", async () => {
    const error = await expectError(db.query("delete from auth.users where id = $1", [admin]));
    expect(error.message).toMatch(/al menos un administrador activo/);
    expect((await getProfile(admin))!.deleted_at).toBeNull();
  });
});
