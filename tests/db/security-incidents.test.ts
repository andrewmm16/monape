import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createTestDatabase, createUser, expectError, user } from "./harness";

/** Incidentes de seguridad: solo administración; la bitácora no se modifica ni se borra. */
let db: PGlite;
let admin: string;
let rrhh: string;
let incidentId: string;
let eventId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin");
  rrhh = await createUser(db, "rrhh", "RRHH");
});

afterAll(async () => {
  await db.close();
});

const as = <T>(actor: string, fn: () => Promise<T>) => asActor(db, user(actor), fn);

describe("incidentes de seguridad", () => {
  it("administración registra un incidente y queda su autor", async () => {
    const { rows } = await as(admin, () =>
      db.query<{ id: string; created_by: string; status: string }>(
        `insert into public.security_incidents (title, severity, is_drill, affected_data)
         values ('Simulacro de prueba', 'alta', true, 'Clave del worker') returning id, created_by, status`,
      ),
    );
    incidentId = rows[0]!.id;
    expect(rows[0]).toMatchObject({ created_by: admin, status: "abierto" });
  });

  it("RRHH no ve nada ni escribe", async () => {
    const { rows } = await as(rrhh, () => db.query("select id from public.security_incidents"));
    expect(rows).toEqual([]);
    await expectError(as(rrhh, () => db.query("insert into public.security_incidents (title, severity) values ('Intento', 'baja')")));
    await expectError(
      as(rrhh, () =>
        db.query("insert into public.security_incident_events (incident_id, kind, description) values ($1, 'nota', 'Intento')", [incidentId]),
      ),
    );
    const update = await as(rrhh, () => db.query("update public.security_incidents set title = 'Cambiado' where id = $1", [incidentId]));
    expect(update.affectedRows).toBe(0);
    const events = await as(rrhh, () => db.query("select id from public.security_incident_events"));
    expect(events.rows).toEqual([]);
  });

  it("sin sesión no se accede a nada", async () => {
    await db.exec("set role anon");
    try {
      await expectError(db.query("select id from public.security_incidents"));
      await expectError(db.query("select id from public.security_incident_events"));
      await expectError(db.query("select officer_name from public.security_settings"));
    } finally {
      await db.exec("reset role");
    }
  });

  it("la notificación exige destinatario y los demás tipos no lo llevan", async () => {
    await expectError(
      as(admin, () =>
        db.query("insert into public.security_incident_events (incident_id, kind, description) values ($1, 'notificacion', 'Sin destinatario')", [
          incidentId,
        ]),
      ),
    );
    await expectError(
      as(admin, () =>
        db.query(
          "insert into public.security_incident_events (incident_id, kind, description, recipient) values ($1, 'accion', 'Con destinatario', 'Alguien')",
          [incidentId],
        ),
      ),
    );
  });

  it("administración anota notificaciones, incluso con una hora anterior", async () => {
    const { rows } = await as(admin, () =>
      db.query<{ id: string; created_by: string }>(
        `insert into public.security_incident_events (incident_id, kind, description, recipient, occurred_at)
         values ($1, 'notificacion', 'Aviso enviado', 'Autoridad Nacional de Protección de Datos Personales', now() - interval '3 hours')
         returning id, created_by`,
        [incidentId],
      ),
    );
    eventId = rows[0]!.id;
    expect(rows[0]!.created_by).toBe(admin);
    const events = await as(admin, () => db.query("select id from public.security_incident_events where incident_id = $1", [incidentId]));
    expect(events.rows).toHaveLength(1);
  });

  it("los eventos no se pueden modificar ni borrar, ni siquiera por administración", async () => {
    await expectError(as(admin, () => db.query("update public.security_incident_events set description = 'Editado' where id = $1", [eventId])));
    await expectError(as(admin, () => db.query("delete from public.security_incident_events where id = $1", [eventId])));
    // Tampoco quien es dueño de la tabla: lo impide el disparador.
    await expectError(db.query("update public.security_incident_events set description = 'Editado' where id = $1", [eventId]));
    await expectError(db.query("delete from public.security_incident_events where id = $1", [eventId]));
  });

  it("los incidentes no se borran", async () => {
    await expectError(as(admin, () => db.query("delete from public.security_incidents where id = $1", [incidentId])));
  });

  it("no se cierra sin causa ni prevención; al cerrar se fija la fecha", async () => {
    await expectError(as(admin, () => db.query("update public.security_incidents set status = 'cerrado' where id = $1", [incidentId])));
    await as(admin, () => db.query("update public.security_incidents set status = 'contenido' where id = $1", [incidentId]));
    const { rows } = await as(admin, () =>
      db.query<{ closed_at: string | null }>(
        "update public.security_incidents set status = 'cerrado', cause = 'Clave pegada en un chat', prevention = 'Rotada' where id = $1 returning closed_at",
        [incidentId],
      ),
    );
    expect(rows[0]!.closed_at).not.toBeNull();
  });

  it("un incidente cerrado no se reabre ni se edita, pero admite la revisión una sola vez", async () => {
    await expectError(as(admin, () => db.query("update public.security_incidents set status = 'abierto' where id = $1", [incidentId])));
    await expectError(as(admin, () => db.query("update public.security_incidents set title = 'Otro título' where id = $1", [incidentId])));
    await as(admin, () =>
      db.query("update public.security_incidents set review_done_at = now(), review_notes = 'Todo bien' where id = $1", [incidentId]),
    );
    await expectError(as(admin, () => db.query("update public.security_incidents set review_notes = 'Otra' where id = $1", [incidentId])));
  });

  it("la revisión no se registra con el incidente abierto", async () => {
    const { rows } = await as(admin, () =>
      db.query<{ id: string }>("insert into public.security_incidents (title, severity) values ('Otro', 'baja') returning id"),
    );
    await expectError(
      as(admin, () => db.query("update public.security_incidents set review_done_at = now(), review_notes = 'x' where id = $1", [rows[0]!.id])),
    );
  });

  it("administración no puede cambiar el autor, el cierre ni el simulacro por su cuenta", async () => {
    await expectError(as(admin, () => db.query("update public.security_incidents set is_drill = false where id = $1", [incidentId])));
    await expectError(as(admin, () => db.query("update public.security_incidents set closed_at = now() where id = $1", [incidentId])));
    await expectError(as(admin, () => db.query("update public.security_incidents set created_by = $2 where id = $1", [incidentId, rrhh])));
  });

  it("queda en la auditoría, sin el contenido", async () => {
    const { rows } = await db.query<{ entity_type: string; action: string; metadata: unknown }>(
      "select entity_type, action, metadata from public.audit_logs where entity_type like 'security_incident%' order by id",
    );
    const types = new Set(rows.map((row) => row.entity_type));
    expect(types).toEqual(new Set(["security_incidents", "security_incident_events"]));
    expect(JSON.stringify(rows)).not.toContain("Clave pegada en un chat");
    expect(JSON.stringify(rows)).not.toContain("Aviso enviado");
  });
});

describe("oficial de datos personales", () => {
  it("es una sola fila, vacía al inicio, que solo ve y edita administración", async () => {
    const initial = await as(admin, () => db.query("select officer_name, designated_at from public.security_settings"));
    expect(initial.rows).toEqual([{ officer_name: null, designated_at: null }]);

    const hidden = await as(rrhh, () => db.query("select id from public.security_settings"));
    expect(hidden.rows).toEqual([]);
    const denied = await as(rrhh, () => db.query("update public.security_settings set officer_name = 'X', officer_email = 'x@empresa.pe'"));
    expect(denied.affectedRows).toBe(0);

    await expectError(as(admin, () => db.query("insert into public.security_settings (id) values (false)")));
  });

  it("al designar queda la fecha y quién lo hizo; nombre y correo van juntos", async () => {
    await expectError(as(admin, () => db.query("update public.security_settings set officer_name = 'Solo nombre'")));
    await expectError(as(admin, () => db.query("update public.security_settings set officer_name = 'Ana', officer_email = 'no-es-correo'")));
    const { rows } = await as(admin, () =>
      db.query<{ officer_name: string; designated_by: string; designated_at: string }>(
        "update public.security_settings set officer_name = 'Ana Ficticia', officer_email = 'ana@empresa.pe' returning officer_name, designated_by, designated_at",
      ),
    );
    expect(rows[0]).toMatchObject({ officer_name: "Ana Ficticia", designated_by: admin });
    expect(rows[0]!.designated_at).not.toBeNull();
  });
});
