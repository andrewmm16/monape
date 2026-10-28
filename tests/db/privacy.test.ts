import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { anon, asActor, createApplication, createCandidate, createTestDatabase, createUser, createVacancy, expectError, user } from "./harness";

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

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/** Crea un borrador como administración y devuelve su id. */
async function draft(title = "Aviso de prueba", body = "Texto del aviso."): Promise<string> {
  const { rows } = await asActor(db, user(admin), () =>
    db.query<{ id: string }>("insert into public.privacy_notices (title, body) values ($1, $2) returning id", [title, body]),
  );
  return rows[0]!.id;
}

function activate(id: string, reference: string | null = "Acta ficticia 001", actor = admin) {
  return asActor(db, user(actor), () => db.query("select public.activate_privacy_notice($1, $2)", [id, reference]));
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await db.query<{ status: string }>("select status from public.privacy_notices where id = $1", [id]);
  return rows[0]!.status;
}

describe("avisos de privacidad", () => {
  it("asigna versiones correlativas y empieza en borrador", async () => {
    const a = await draft();
    const b = await draft();
    const { rows } = await db.query<{ id: string; version: number; status: string; created_by: string }>(
      "select id, version, status, created_by from public.privacy_notices where id in ($1, $2) order by version",
      [a, b],
    );
    expect(rows.map((r) => r.status)).toEqual(["borrador", "borrador"]);
    expect(rows[1]!.version).toBe(rows[0]!.version + 1);
    expect(rows[0]!.created_by).toBe(admin);
    // El cliente no puede elegir la versión ni el estado.
    await expectError(
      asActor(db, user(admin), () =>
        db.query("insert into public.privacy_notices (title, body, status) values ('x', 'y', 'vigente')"),
      ),
    );
    const forced = await asActor(db, user(admin), () =>
      db.query<{ version: number }>("insert into public.privacy_notices (title, body) values ('x', 'y') returning version"),
    );
    expect(forced.rows[0]!.version).toBe(rows[1]!.version + 1);
  });

  it("valida longitudes de título y texto", async () => {
    await expectError(asActor(db, user(admin), () => db.query("insert into public.privacy_notices (title, body) values ('', 'x')")));
    await expectError(
      asActor(db, user(admin), () => db.query("insert into public.privacy_notices (title, body) values ('x', $1)", ["a".repeat(20001)])),
    );
    await expectError(
      asActor(db, user(admin), () => db.query("insert into public.privacy_notices (title, body) values ($1, 'x')", ["a".repeat(201)])),
    );
    await asActor(db, user(admin), () =>
      db.query("insert into public.privacy_notices (title, body) values ($1, $2)", ["a".repeat(200), "b".repeat(20000)]),
    );
  });

  it("no se activa sin referencia de aprobación", async () => {
    const id = await draft();
    await expectError(activate(id, null));
    await expectError(activate(id, "   "));
    await expectError(activate(id, "x".repeat(501)));
    expect(await statusOf(id)).toBe("borrador");
    // La restricción también vale fuera de la función.
    await expectError(db.query("update public.privacy_notices set status = 'vigente', effective_from = now() where id = $1", [id]));
  });

  it("activar fija vigencia y aprobador, y retira la vigente anterior", async () => {
    const first = await draft("Primera");
    const second = await draft("Segunda");
    await activate(first, "Acta 1");
    expect(await statusOf(first)).toBe("vigente");
    const { rows } = await db.query<{ approval_reference: string; approved_by: string; effective_from: string }>(
      "select approval_reference, approved_by, effective_from from public.privacy_notices where id = $1",
      [first],
    );
    expect(rows[0]).toMatchObject({ approval_reference: "Acta 1", approved_by: admin });
    expect(rows[0]!.effective_from).toBeTruthy();

    await activate(second, "Acta 2");
    expect(await statusOf(first)).toBe("retirado");
    expect(await statusOf(second)).toBe("vigente");
    const vigentes = await db.query("select 1 from public.privacy_notices where status = 'vigente'");
    expect(vigentes.rows).toHaveLength(1);
  });

  it("solo puede haber una vigente", async () => {
    const vigente = await db.query<{ id: string }>("select id from public.privacy_notices where status = 'vigente'");
    expect(vigente.rows).toHaveLength(1);
    const id = await draft();
    const error = await expectError(
      db.query("update public.privacy_notices set status = 'vigente', approval_reference = 'x', effective_from = now() where id = $1", [id]),
    );
    expect(error.message).toMatch(/privacy_notices_single_current_idx|duplicate/i);
  });

  it("la vigente y la retirada no se modifican ni se borran, ni siquiera por administración", async () => {
    const { rows } = await db.query<{ id: string; status: string }>(
      "select id, status from public.privacy_notices where status in ('vigente', 'retirado')",
    );
    expect(rows.map((r) => r.status)).toEqual(expect.arrayContaining(["vigente", "retirado"]));
    for (const row of rows) {
      // Como administración: RLS no deja ver la fila a modificar.
      const updated = await asActor(db, user(admin), () =>
        db.query("update public.privacy_notices set title = 'Cambiado' where id = $1", [row.id]),
      );
      expect(updated.affectedRows).toBe(0);
      const deleted = await asActor(db, user(admin), () => db.query("delete from public.privacy_notices where id = $1", [row.id]));
      expect(deleted.affectedRows).toBe(0);
      // Y el disparador lo impide aunque se salte RLS (superusuario).
      await expectError(db.query("update public.privacy_notices set body = 'Cambiado' where id = $1", [row.id]));
      await expectError(db.query("update public.privacy_notices set approval_reference = 'otra' where id = $1", [row.id]));
      await expectError(db.query("delete from public.privacy_notices where id = $1", [row.id]));
    }
    // Una retirada no vuelve a vigente ni a borrador.
    const retired = rows.find((r) => r.status === "retirado")!;
    await expectError(db.query("update public.privacy_notices set status = 'vigente' where id = $1", [retired.id]));
    await expectError(db.query("update public.privacy_notices set status = 'borrador' where id = $1", [retired.id]));
    await expectError(activate(retired.id));
  });

  it("un borrador se edita y se elimina; la versión no cambia", async () => {
    const id = await draft("Original", "Texto");
    const before = await db.query<{ version: number }>("select version from public.privacy_notices where id = $1", [id]);
    await asActor(db, user(admin), () => db.query("update public.privacy_notices set title = 'Editado', body = 'Nuevo' where id = $1", [id]));
    const { rows } = await db.query<{ title: string; version: number }>("select title, version from public.privacy_notices where id = $1", [id]);
    expect(rows[0]).toEqual({ title: "Editado", version: before.rows[0]!.version });
    await expectError(db.query("update public.privacy_notices set version = 999 where id = $1", [id]));
    await expectError(asActor(db, user(admin), () => db.query("update public.privacy_notices set version = 999 where id = $1", [id])));
    await asActor(db, user(admin), () => db.query("delete from public.privacy_notices where id = $1", [id]));
    expect((await db.query("select 1 from public.privacy_notices where id = $1", [id])).rows).toHaveLength(0);
  });

  it("solo administración gestiona los avisos; RRHH solo lee", async () => {
    const id = await draft();
    await expectError(
      asActor(db, user(rrhh), () => db.query("insert into public.privacy_notices (title, body) values ('x', 'y')")),
    );
    // RLS oculta las filas a modificar: no falla, pero no afecta ninguna.
    const updated = await asActor(db, user(rrhh), () => db.query("update public.privacy_notices set title = 'x' where id = $1", [id]));
    expect(updated.affectedRows).toBe(0);
    const deleted = await asActor(db, user(rrhh), () => db.query("delete from public.privacy_notices where id = $1", [id]));
    expect(deleted.affectedRows).toBe(0);
    await expectError(activate(id, "Acta ficticia", rrhh));
    expect(await statusOf(id)).toBe("borrador");
    const read = await asActor(db, user(rrhh), () => db.query("select id from public.privacy_notices"));
    expect(read.rows.length).toBeGreaterThan(0);
    // Administración tampoco puede fijar el estado ni la referencia directamente.
    await expectError(asActor(db, user(admin), () => db.query("update public.privacy_notices set status = 'vigente' where id = $1", [id])));
    await expectError(asActor(db, user(admin), () => db.query("update public.privacy_notices set approval_reference = 'x' where id = $1", [id])));
  });

  it("anon no tiene privilegios y current_privacy_notice es solo de service_role", async () => {
    await expectError(asActor(db, anon, () => db.query("select * from public.privacy_notices")));
    await expectError(asActor(db, anon, () => db.query("select * from public.consent_records")));
    await expectError(asActor(db, anon, () => db.query("select * from public.current_privacy_notice()")));
    await expectError(asActor(db, anon, () => db.query("select public.revoke_consent(gen_random_uuid())")));
    await expectError(asActor(db, anon, () => db.query("select public.activate_privacy_notice(gen_random_uuid(), 'x')")));
    await expectError(asActor(db, user(admin), () => db.query("select * from public.current_privacy_notice()")));
    await expectError(asActor(db, user(rrhh), () => db.query("select * from public.current_privacy_notice()")));

    const { rows } = await asService(() =>
      db.query<{ id: string; version: number; title: string; body: string; effective_from: string }>(
        "select * from public.current_privacy_notice()",
      ),
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["body", "effective_from", "id", "title", "version"]);
    const vigente = await db.query<{ id: string }>("select id from public.privacy_notices where status = 'vigente'");
    expect(rows[0]!.id).toBe(vigente.rows[0]!.id);
  });

  it("los avisos quedan en la auditoría sin su texto", async () => {
    const id = await draft("Titulo auditado", "Cuerpo secreto de auditoría");
    const { rows } = await db.query<{ metadata: unknown; action: string }>(
      "select action, metadata from public.audit_logs where entity_type = 'privacy_notices' and entity_id = $1",
      [id],
    );
    expect(rows.map((r) => r.action)).toContain("insert");
    expect(JSON.stringify(rows)).not.toContain("Cuerpo secreto");
  });
});

describe("constancias de consentimiento", () => {
  let candidateId: string;
  let applicationId: string;
  let noticeId: string;

  async function record(
    purpose: "proceso_seleccion" | "cartera_talento",
    granted = true,
    options: { notice?: string; application?: string | null; recordedBy?: string | null } = {},
  ): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select private.record_consent($1, $2, $3, $4::public.consent_purpose, $5, 'formulario_en_linea', $6) as id`,
      [
        candidateId,
        options.application === undefined ? applicationId : options.application,
        options.notice ?? noticeId,
        purpose,
        granted,
        options.recordedBy ?? null,
      ],
    );
    return rows[0]!.id;
  }

  beforeAll(async () => {
    candidateId = await createCandidate(db);
    const vacancyId = await createVacancy(db);
    applicationId = await createApplication(db, candidateId, vacancyId);
    const vigente = await db.query<{ id: string }>("select id from public.privacy_notices where status = 'vigente'");
    noticeId = vigente.rows[0]!.id;
  });

  it("record_consent guarda la constancia con el aviso vigente", async () => {
    const id = await record("cartera_talento");
    const { rows } = await db.query<Record<string, unknown>>("select * from public.consent_records where id = $1", [id]);
    expect(rows[0]).toMatchObject({
      candidate_id: candidateId,
      application_id: applicationId,
      notice_id: noticeId,
      purpose: "cartera_talento",
      granted: true,
      method: "formulario_en_linea",
      recorded_by: null,
      revoked_at: null,
    });
    // Sin IP ni user agent.
    expect(Object.keys(rows[0]!)).not.toEqual(expect.arrayContaining(["ip", "user_agent"]));
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'consent_records'",
    );
    expect(columns.rows.map((c) => c.column_name).join(",")).not.toMatch(/ip|agent/);
  });

  it("record_consent rechaza un aviso no vigente (borrador o retirado) o inexistente", async () => {
    const borrador = await draft();
    await expectError(record("cartera_talento", true, { notice: borrador }));
    const retirado = await db.query<{ id: string }>("select id from public.privacy_notices where status = 'retirado' limit 1");
    await expectError(record("cartera_talento", true, { notice: retirado.rows[0]!.id }));
    await expectError(record("cartera_talento", true, { notice: "00000000-0000-0000-0000-000000000000" }));
    const other = await createCandidate(db, "Otra Persona Ficticia");
    await expectError(
      db.query(
        "select private.record_consent($1, $2, $3, 'proceso_seleccion', true, 'registro_manual', null)",
        [other, applicationId, noticeId],
      ),
    );
  });

  it("ningún usuario inserta, modifica ni borra directamente", async () => {
    const id = await record("cartera_talento");
    for (const actor of [user(admin), user(rrhh), anon]) {
      await expectError(
        asActor(db, actor, () =>
          db.query(
            "insert into public.consent_records (candidate_id, notice_id, purpose, granted, method) values ($1, $2, 'cartera_talento', true, 'registro_manual')",
            [candidateId, noticeId],
          ),
        ),
      );
      await expectError(asActor(db, actor, () => db.query("update public.consent_records set granted = false where id = $1", [id])));
      await expectError(asActor(db, actor, () => db.query("delete from public.consent_records where id = $1", [id])));
    }
    await expectError(asActor(db, user(admin), () => db.query("select private.record_consent($1, null, $2, 'cartera_talento', true, 'registro_manual', null)", [candidateId, noticeId])));
  });

  it("el personal lee las constancias", async () => {
    for (const actor of [user(admin), user(rrhh)]) {
      const { rows } = await asActor(db, actor, () => db.query("select id from public.consent_records where candidate_id = $1", [candidateId]));
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  it("revoke_consent solo revoca cartera otorgada y no revocada, sin borrar la fila", async () => {
    const cartera = await record("cartera_talento");
    await asActor(db, user(rrhh), () => db.query("select public.revoke_consent($1)", [cartera]));
    const { rows } = await db.query<{ revoked_at: string | null; revoked_by: string | null; granted: boolean }>(
      "select revoked_at, revoked_by, granted from public.consent_records where id = $1",
      [cartera],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked_at).not.toBeNull();
    expect(rows[0]!.revoked_by).toBe(rrhh);
    expect(rows[0]!.granted).toBe(true);

    const audit = await db.query<{ actor_id: string; metadata: { changed_fields: string[] } }>(
      "select actor_id, metadata from public.audit_logs where entity_type = 'consent_records' and entity_id = $1 and action = 'update'",
      [cartera],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_id).toBe(rrhh);
    expect(audit.rows[0]!.metadata.changed_fields).toEqual(["revoked_at", "revoked_by"]);

    // Ya revocada.
    await expectError(asActor(db, user(admin), () => db.query("select public.revoke_consent($1)", [cartera])));
    // Proceso de selección: no se revoca.
    const proceso = await record("proceso_seleccion");
    await expectError(asActor(db, user(rrhh), () => db.query("select public.revoke_consent($1)", [proceso])));
    // No otorgada.
    const rechazada = await record("cartera_talento", false);
    await expectError(asActor(db, user(rrhh), () => db.query("select public.revoke_consent($1)", [rechazada])));
    // Inexistente y anónimo.
    await expectError(asActor(db, user(rrhh), () => db.query("select public.revoke_consent(gen_random_uuid())")));
    const stillThere = await db.query("select 1 from public.consent_records where id in ($1, $2, $3)", [cartera, proceso, rechazada]);
    expect(stillThere.rows).toHaveLength(3);
  });

  it("borrar al candidato borra sus constancias (en cascada)", async () => {
    const lonely = await createCandidate(db, "Candidato Eliminable");
    await db.query(
      "select private.record_consent($1, null, $2, 'proceso_seleccion', true, 'registro_manual', $3)",
      [lonely, noticeId, admin],
    );
    const { rows } = await db.query<{ recorded_by: string }>("select recorded_by from public.consent_records where candidate_id = $1", [lonely]);
    expect(rows[0]!.recorded_by).toBe(admin);
    await db.query("delete from public.candidates where id = $1", [lonely]);
    expect((await db.query("select 1 from public.consent_records where candidate_id = $1", [lonely])).rows).toHaveLength(0);
  });
});
