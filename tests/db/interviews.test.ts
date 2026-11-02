import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addRequirement,
  anon,
  asActor,
  createApplication,
  createCandidate,
  createTestDatabase,
  createUser,
  createVacancy,
  expectError,
  user,
} from "./harness";

/**
 * Entrevistas: tabla (solo lectura directa), funciones de agendar, reprogramar,
 * cancelar y registrar resultado, cambios de estado, eventos, verificaciones con
 * fuente «entrevista» y auditoría.
 */
let db: PGlite;
const ids = {} as {
  rrhh: string;
  admin: string;
  inactivo: string;
  vacancy: string;
  archived: string;
  ingles: string;
  sql: string;
  foreign: string;
};

// 05/11/2026 15:00 en Lima.
const WHEN = "2026-11-05T15:00:00-05:00";
const WHEN_TEXT = "05/11/2026";
const rrhh = () => user(ids.rrhh);

beforeAll(async () => {
  db = await createTestDatabase();
  ids.rrhh = await createUser(db, "rrhh", "Luis Ficticio");
  ids.admin = await createUser(db, "admin", "Admin Ficticio");
  ids.inactivo = await createUser(db, "rrhh", "RRHH Inactivo");
  await db.query("update public.profiles set is_active = false where id = $1", [ids.inactivo]);
  ids.vacancy = await createVacancy(db, { title: "Analista de entrevistas" });
  ids.ingles = await addRequirement(db, ids.vacancy, { description: "Inglés intermedio", weight: 5 });
  ids.sql = await addRequirement(db, ids.vacancy, { description: "SQL", weight: 3 });
  ids.archived = await createVacancy(db, { title: "Vacante archivada de prueba", status: "borrador" });
  const other = await createVacancy(db, { title: "Otra vacante" });
  ids.foreign = await addRequirement(db, other, { description: "Requisito ajeno", weight: 1 });
});

afterAll(async () => {
  await db?.close();
});

async function newApplication(vacancy = ids.vacancy, status?: string) {
  const id = await createApplication(db, await createCandidate(db), vacancy);
  if (status) {
    await asActor(db, rrhh(), () =>
      db.query("select public.change_application_status($1, $2::public.application_status, 'Motivo de prueba')", [id, status]),
    );
  }
  return id;
}

type Fields = Partial<{ when: string; duration: number; modality: string; location: string | null; interviewers: string | null; instructions: string | null }>;

async function schedule(application: string, fields: Fields = {}, actor = rrhh()) {
  const { rows } = await asActor(db, actor, () =>
    db.query<{ id: string }>(
      "select public.schedule_interview($1, $2, $3, $4::public.interview_modality, $5, $6, $7) as id",
      [
        application,
        fields.when ?? WHEN,
        fields.duration ?? 45,
        fields.modality ?? "virtual",
        fields.location === undefined ? "https://meet.ejemplo.test/abc" : fields.location,
        fields.interviewers === undefined ? "Ana Gómez, Pedro Ruiz" : fields.interviewers,
        fields.instructions === undefined ? "Tener el DNI a la mano" : fields.instructions,
      ],
    ),
  );
  return rows[0]!.id;
}

const record = (interview: string, outcome: string, notes: string | null = null, verifications: unknown = [], actor = rrhh()) =>
  asActor(db, actor, () =>
    db.query<{ id: string }>("select public.record_interview_result($1, $2, $3, $4::jsonb) as id", [
      interview,
      outcome,
      notes,
      JSON.stringify(verifications),
    ]),
  );

const cancel = (interview: string, reason: string | null, actor = rrhh()) =>
  asActor(db, actor, () => db.query("select public.cancel_interview($1, $2)", [interview, reason]));

const reschedule = (interview: string, when = "2026-11-06T09:30:00-05:00", duration = 60, actor = rrhh()) =>
  asActor(db, actor, () =>
    db.query("select public.reschedule_interview($1, $2, $3, 'telefonica', 'Llamar al +51 999 000 111', 'Ana Gómez', null)", [
      interview,
      when,
      duration,
    ]),
  );

async function statusOf(application: string) {
  const { rows } = await db.query<{ status: string }>("select status from public.applications where id = $1", [application]);
  return rows[0]!.status;
}

async function events(application: string, types?: string[]) {
  const { rows } = await db.query<{ event_type: string; from_status: string | null; to_status: string | null; reason: string | null; note: string | null; actor_id: string | null }>(
    "select event_type, from_status, to_status, reason, note, actor_id from public.application_events where application_id = $1 order by id",
    [application],
  );
  return types ? rows.filter((r) => types.includes(r.event_type)) : rows;
}

async function interviewRow(id: string) {
  const { rows } = await db.query<Record<string, string | number | null>>("select * from public.interviews where id = $1", [id]);
  return rows[0]!;
}

describe("autorización", () => {
  it("anon no puede llamar a las funciones ni leer la tabla", async () => {
    const application = await newApplication();
    const interview = await schedule(application);
    await expectError(asActor(db, anon, () => db.query("select public.schedule_interview($1, $2, 45, 'virtual')", [application, WHEN])));
    await expectError(asActor(db, anon, () => db.query("select public.reschedule_interview($1, $2, 45, 'virtual')", [interview, WHEN])));
    await expectError(asActor(db, anon, () => db.query("select public.cancel_interview($1, 'Motivo')", [interview])));
    await expectError(asActor(db, anon, () => db.query("select public.record_interview_result($1, 'paso')", [interview])));
    await expectError(asActor(db, anon, () => db.query("select * from public.interviews")));
  });

  it("un usuario inactivo no puede escribir", async () => {
    const application = await newApplication();
    const error = await expectError(schedule(application, {}, user(ids.inactivo)));
    expect(error.message).toBe("No autorizado");
  });

  it("el personal activo lee la tabla pero no escribe directamente", async () => {
    const application = await newApplication();
    const interview = await schedule(application);
    const { rows } = await asActor(db, rrhh(), () => db.query("select id from public.interviews where id = $1", [interview]));
    expect(rows).toHaveLength(1);
    await expectError(
      asActor(db, rrhh(), () =>
        db.query("insert into public.interviews (application_id, scheduled_at, modality) values ($1, now(), 'virtual')", [application]),
      ),
    );
    await expectError(asActor(db, rrhh(), () => db.query("update public.interviews set status = 'cancelada' where id = $1", [interview])));
    await expectError(asActor(db, rrhh(), () => db.query("delete from public.interviews where id = $1", [interview])));
    expect((await interviewRow(interview)).status).toBe("programada");
  });

  it("las funciones privadas no son invocables por usuarios", async () => {
    const application = await newApplication();
    await expectError(
      asActor(db, rrhh(), () =>
        db.query("select private.apply_application_status($1, 'nuevo', 'retirado', 'x', null)", [application]),
      ),
    );
    await expectError(
      asActor(db, rrhh(), () => db.query("select private.save_requirement_verifications($1, '[]'::jsonb, null)", [application])),
    );
  });

  it("la entrevista de una postulación inexistente o ajena falla con un mensaje claro", async () => {
    const error = await expectError(schedule("00000000-0000-4000-8000-000000000000"));
    expect(error.message).toMatch(/no encontrada/);
    const missing = await expectError(record("00000000-0000-4000-8000-000000000000", "paso"));
    expect(missing.message).toMatch(/no existe/);
  });
});

describe("schedule_interview", () => {
  it("guarda la entrevista con textos recortados y vacíos como nulos", async () => {
    const application = await newApplication();
    const id = await schedule(application, { location: "  Av. Larco 345  ", interviewers: "   ", instructions: null, duration: 90 });
    const row = await interviewRow(id);
    expect(row).toMatchObject({
      application_id: application,
      duration_minutes: 90,
      modality: "virtual",
      location: "Av. Larco 345",
      interviewers: null,
      instructions: null,
      status: "programada",
      result: null,
      created_by: ids.rrhh,
    });
    expect(new Date(row.scheduled_at as unknown as string).toISOString()).toBe("2026-11-05T20:00:00.000Z");
  });

  it("cambia el estado a «entrevista programada» con motivo, hora de Lima y eventos", async () => {
    const application = await newApplication(ids.vacancy, "preseleccionado");
    const interview = await schedule(application);
    expect(await statusOf(application)).toBe("entrevista_programada");
    const log = await events(application, ["entrevista_programada", "cambio_estado"]);
    expect(log.map((e) => e.event_type)).toEqual(["cambio_estado", "entrevista_programada", "cambio_estado"]);
    const change = log[2]!;
    expect(change).toMatchObject({
      from_status: "preseleccionado",
      to_status: "entrevista_programada",
      reason: "Entrevista programada para el 05/11/2026 15:00",
      actor_id: ids.rrhh,
    });
    expect(log[1]!.note).toBe("Para el 05/11/2026 15:00 (45 min, virtual)");
    expect(interview).toBeTruthy();
  });

  it("si ya estaba en «entrevista programada» no repite el cambio de estado", async () => {
    const application = await newApplication();
    await schedule(application);
    await schedule(application, { when: "2026-11-07T10:00:00-05:00" });
    const changes = await events(application, ["cambio_estado"]);
    expect(changes.filter((e) => e.to_status === "entrevista_programada")).toHaveLength(1);
    expect(await events(application, ["entrevista_programada"])).toHaveLength(2);
  });

  it("desde «en evaluación» o «en reserva» vuelve a «entrevista programada»", async () => {
    for (const status of ["en_evaluacion", "en_reserva"]) {
      const application = await newApplication(ids.vacancy, status);
      await schedule(application);
      expect(await statusOf(application)).toBe("entrevista_programada");
    }
  });

  it("acepta fechas pasadas (para registrar una entrevista ya hecha)", async () => {
    const application = await newApplication();
    const id = await schedule(application, { when: "2025-01-10T09:00:00-05:00" });
    expect((await interviewRow(id)).status).toBe("programada");
  });

  it("rechaza postulaciones cerradas", async () => {
    for (const status of ["no_seleccionado", "retirado", "seleccionado"]) {
      const application = await newApplication(ids.vacancy, status);
      const error = await expectError(schedule(application));
      expect(error.message).toMatch(/cerrada/);
      expect(await statusOf(application)).toBe(status);
      const { rows } = await db.query("select 1 from public.interviews where application_id = $1", [application]);
      expect(rows).toHaveLength(0);
    }
  });

  it("rechaza vacantes archivadas", async () => {
    const application = await newApplication(ids.archived);
    await db.query("update public.vacancies set status = 'archivada' where id = $1", [ids.archived]);
    expect((await expectError(schedule(application))).message).toMatch(/archivada/);
  });

  it("valida duración, fecha y longitudes", async () => {
    const application = await newApplication();
    expect((await expectError(schedule(application, { duration: 10 }))).message).toMatch(/duración/);
    expect((await expectError(schedule(application, { duration: 481 }))).message).toMatch(/duración/);
    expect((await expectError(schedule(application, { location: "x".repeat(501) }))).message).toMatch(/500/);
    expect((await expectError(schedule(application, { interviewers: "x".repeat(301) }))).message).toMatch(/300/);
    expect((await expectError(schedule(application, { instructions: "x".repeat(2001) }))).message).toMatch(/2000/);
    await expectError(
      asActor(db, rrhh(), () => db.query("select public.schedule_interview($1, null, 45, 'virtual')", [application])),
    );
    await expectError(
      asActor(db, rrhh(), () => db.query("select public.schedule_interview($1, $2, 45, null)", [application, WHEN])),
    );
    expect(await statusOf(application)).toBe("nuevo");
  });
});

describe("reschedule_interview", () => {
  it("cambia fecha, duración y modalidad, y registra el evento", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await reschedule(id);
    const row = await interviewRow(id);
    expect(row).toMatchObject({ duration_minutes: 60, modality: "telefonica", location: "Llamar al +51 999 000 111", interviewers: "Ana Gómez", instructions: null });
    expect(new Date(row.scheduled_at as unknown as string).toISOString()).toBe("2026-11-06T14:30:00.000Z");
    const [event] = await events(application, ["entrevista_reprogramada"]);
    expect(event!.note).toBe("Del 05/11/2026 15:00 al 06/11/2026 09:30 (60 min, telefonica)");
    expect(event!.actor_id).toBe(ids.rrhh);
    expect(await statusOf(application)).toBe("entrevista_programada");
  });

  it("solo si está programada", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await cancel(id, "Pidió otra fecha");
    expect((await expectError(reschedule(id))).message).toMatch(/programada/);
    const done = await schedule(application);
    await record(done, "paso");
    expect((await expectError(reschedule(done))).message).toMatch(/programada/);
  });

  it("valida los datos y la autorización", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    expect((await expectError(reschedule(id, WHEN, 5))).message).toMatch(/duración/);
    await expectError(reschedule(id, WHEN, 45, user(ids.inactivo)));
    await expectError(asActor(db, anon, () => db.query("select public.reschedule_interview($1, $2, 45, 'virtual')", [id, WHEN])));
    expect((await expectError(reschedule("00000000-0000-4000-8000-000000000000"))).message).toMatch(/no existe/);
  });
});

describe("cancel_interview", () => {
  it("exige el motivo, cancela y no cambia el estado de la postulación", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    expect((await expectError(cancel(id, "  "))).message).toMatch(/motivo/);
    expect((await expectError(cancel(id, "ab"))).message).toMatch(/motivo/);
    expect((await expectError(cancel(id, "x".repeat(501)))).message).toMatch(/motivo/);
    expect((await interviewRow(id)).status).toBe("programada");
    await cancel(id, "  El candidato pidió otra fecha  ");
    expect(await interviewRow(id)).toMatchObject({ status: "cancelada", cancel_reason: "El candidato pidió otra fecha", result: null });
    expect(await statusOf(application)).toBe("entrevista_programada");
    const [event] = await events(application, ["entrevista_cancelada"]);
    expect(event).toMatchObject({ reason: "El candidato pidió otra fecha", note: "Entrevista del 05/11/2026 15:00", actor_id: ids.rrhh });
  });

  it("solo si está programada", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await cancel(id, "Motivo válido");
    expect((await expectError(cancel(id, "Otra vez"))).message).toMatch(/programada/);
    const done = await schedule(application);
    await record(done, "no_asistio");
    expect((await expectError(cancel(done, "Motivo válido"))).message).toMatch(/programada/);
  });
});

describe("record_interview_result", () => {
  it("«pasó»: entrevista realizada y la postulación pasa a «en evaluación»", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    const { rows } = await record(id, "paso", "  Buena conversación  ");
    expect(rows[0]!.id).toBe(application);
    expect(await interviewRow(id)).toMatchObject({
      status: "realizada",
      result: "paso",
      result_notes: "Buena conversación",
      result_recorded_by: ids.rrhh,
    });
    expect((await interviewRow(id)).result_recorded_at).not.toBeNull();
    expect(await statusOf(application)).toBe("en_evaluacion");
    const changes = (await events(application, ["cambio_estado"])).at(-1)!;
    expect(changes).toMatchObject({ from_status: "entrevista_programada", to_status: "en_evaluacion", reason: `Pasó la entrevista del ${WHEN_TEXT}` });
    const [event] = await events(application, ["entrevista_resultado"]);
    expect(event).toMatchObject({ reason: "Pasó", note: `Entrevista del ${WHEN_TEXT}: Buena conversación` });
  });

  it("«pasó» sin cambio si ya está «en evaluación»", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await asActor(db, rrhh(), () =>
      db.query("select public.change_application_status($1, 'en_evaluacion')", [application]),
    );
    await record(id, "paso");
    const toEvaluation = (await events(application, ["cambio_estado"])).filter((e) => e.to_status === "en_evaluacion");
    expect(toEvaluation).toHaveLength(1);
    expect(toEvaluation[0]!.reason).toBeNull();
  });

  it("«no pasó»: la nota es obligatoria y no se registra nada sin ella", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    expect((await expectError(record(id, "no_paso"))).message).toMatch(/motivo/);
    expect((await expectError(record(id, "no_paso", "  ab "))).message).toMatch(/motivo/);
    expect((await interviewRow(id)).status).toBe("programada");
    expect(await statusOf(application)).toBe("entrevista_programada");
  });

  it("«no pasó»: pasa a «no seleccionado» con el motivo y conserva todo", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await record(id, "no_paso", "No cumple la experiencia requerida");
    expect(await interviewRow(id)).toMatchObject({ status: "realizada", result: "no_paso", result_notes: "No cumple la experiencia requerida" });
    expect(await statusOf(application)).toBe("no_seleccionado");
    const change = (await events(application, ["cambio_estado"])).at(-1)!;
    expect(change).toMatchObject({
      from_status: "entrevista_programada",
      to_status: "no_seleccionado",
      reason: `No pasó la entrevista del ${WHEN_TEXT}: No cumple la experiencia requerida`,
    });
    // Nada se borra y se puede reactivar.
    const { rows } = await db.query("select 1 from public.applications where id = $1", [application]);
    expect(rows).toHaveLength(1);
    await asActor(db, rrhh(), () => db.query("select public.change_application_status($1, 'en_revision')", [application]));
    expect(await statusOf(application)).toBe("en_revision");
    expect((await events(application, ["entrevista_resultado"]))).toHaveLength(1);
  });

  it("recorta el motivo del cambio de estado a 500 caracteres", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await record(id, "no_paso", "m".repeat(900));
    const change = (await events(application, ["cambio_estado"])).at(-1)!;
    expect(change.reason).toHaveLength(500);
    expect(change.reason!.startsWith(`No pasó la entrevista del ${WHEN_TEXT}: mmm`)).toBe(true);
    expect((await interviewRow(id)).result_notes).toHaveLength(900);
    expect((await expectError(record(await schedule(await newApplication()), "paso", "n".repeat(4001)))).message).toMatch(/4000/);
  });

  it("«no asistió»: no cambia el estado de la postulación", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await record(id, "no_asistio", "No contestó el teléfono");
    expect(await interviewRow(id)).toMatchObject({ status: "no_asistio", result: null, result_notes: "No contestó el teléfono", result_recorded_by: ids.rrhh });
    expect(await statusOf(application)).toBe("entrevista_programada");
    const [event] = await events(application, ["entrevista_resultado"]);
    expect(event!.reason).toBe("No asistió");
  });

  it("en una vacante archivada registra el resultado sin cambiar el estado", async () => {
    const vacancy = await createVacancy(db, { title: "Vacante que se archiva" });
    const application = await newApplication(vacancy);
    const id = await schedule(application);
    await db.query("update public.vacancies set status = 'archivada' where id = $1", [vacancy]);
    await record(id, "no_paso", "Sin experiencia");
    expect((await interviewRow(id)).status).toBe("realizada");
    expect(await statusOf(application)).toBe("entrevista_programada");
  });

  it("solo si está programada y con un resultado válido", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    expect((await expectError(record(id, "talvez"))).message).toMatch(/resultado/);
    expect((await expectError(record(id, ""))).message).toMatch(/resultado/);
    await record(id, "paso");
    expect((await expectError(record(id, "no_paso", "Motivo válido"))).message).toMatch(/programada/);
    expect(await statusOf(application)).toBe("en_evaluacion");
  });

  it("exige autorización", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    expect((await expectError(record(id, "paso", null, [], user(ids.inactivo)))).message).toBe("No autorizado");
    expect((await interviewRow(id)).status).toBe("programada");
  });
});

describe("requisitos comprobados en la entrevista", () => {
  const verificationsOf = async (application: string) => {
    const { rows } = await db.query<{ requirement_id: string; result: string; source: string; note: string; interview_id: string | null; verified_by: string | null }>(
      "select requirement_id, result, source, note, interview_id, verified_by from public.requirement_verifications where application_id = $1 order by note",
      [application],
    );
    return rows;
  };

  it("se guardan con fuente «entrevista», interview_id y nota por defecto", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await record(id, "paso", null, [
      { requirement_id: ids.ingles, result: "acreditado" },
      { requirement_id: ids.sql, result: "no_cumplido", note: "  No domina consultas con joins  " },
    ]);
    const rows = await verificationsOf(application);
    expect(rows).toHaveLength(2);
    const ingles = rows.find((r) => r.requirement_id === ids.ingles)!;
    const sql = rows.find((r) => r.requirement_id === ids.sql)!;
    expect(ingles).toMatchObject({ result: "acreditado", source: "entrevista", interview_id: id, verified_by: ids.rrhh, note: `Comprobado en la entrevista del ${WHEN_TEXT}` });
    expect(sql).toMatchObject({ result: "no_cumplido", source: "entrevista", interview_id: id, note: "No domina consultas con joins" });
    expect(await events(application, ["requisito_verificado"])).toHaveLength(1);
  });

  it("se ignoran si no asistió", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await record(id, "no_asistio", null, [{ requirement_id: ids.ingles, result: "acreditado" }]);
    expect(await verificationsOf(application)).toHaveLength(0);
  });

  it("una verificación inválida deshace todo el resultado", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    const cases: unknown[] = [
      [{ requirement_id: ids.foreign, result: "acreditado" }],
      [{ requirement_id: ids.ingles, result: "sin_evidencia" }],
      [{ requirement_id: ids.ingles, result: "acreditado", note: "ab" }],
      [{ requirement_id: ids.ingles, result: "acreditado" }, { requirement_id: ids.ingles, result: "no_cumplido" }],
      [{ requirement_id: "no-es-uuid", result: "acreditado" }],
      ["texto"],
      Array.from({ length: 31 }, () => ({ requirement_id: ids.ingles, result: "acreditado" })),
    ];
    for (const verifications of cases) {
      await expectError(record(id, "paso", null, verifications));
    }
    await expectError(asActor(db, rrhh(), () => db.query("select public.record_interview_result($1, 'paso', null, '{}'::jsonb)", [id])));
    expect((await interviewRow(id)).status).toBe("programada");
    expect(await statusOf(application)).toBe("entrevista_programada");
    expect(await verificationsOf(application)).toHaveLength(0);
  });

  it("verify_requirements conserva su comportamiento y desvincula la entrevista", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await record(id, "paso", null, [{ requirement_id: ids.ingles, result: "acreditado" }]);
    expect((await verificationsOf(application))[0]!.interview_id).toBe(id);
    await asActor(db, user(ids.admin), () =>
      db.query(
        `select public.verify_requirements($1, $2::jsonb)`,
        [application, JSON.stringify([{ requirement_id: ids.ingles, result: "no_cumplido", source: "documento", note: "Certificado vencido" }])],
      ),
    );
    expect(await verificationsOf(application)).toMatchObject([{ result: "no_cumplido", source: "documento", interview_id: null, verified_by: ids.admin }]);
    // Mismas reglas de siempre.
    await expectError(asActor(db, rrhh(), () => db.query("select public.verify_requirements($1, '[]'::jsonb)", [application])));
    await expectError(asActor(db, anon, () => db.query("select public.verify_requirements($1, '[]'::jsonb)", [application])));
  });

  it("al borrar la entrevista las verificaciones se conservan sin vínculo", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await record(id, "paso", null, [{ requirement_id: ids.sql, result: "acreditado" }]);
    await db.query("delete from public.interviews where id = $1", [id]);
    expect(await verificationsOf(application)).toMatchObject([{ source: "entrevista", interview_id: null }]);
  });
});

describe("restricciones de la tabla", () => {
  const insert = (application: string, columns: string, values: string) =>
    db.query(`insert into public.interviews (application_id, scheduled_at, modality, ${columns}) values ($1, now(), 'virtual', ${values})`, [application]);

  it("«realizada» exige resultado y viceversa", async () => {
    const application = await newApplication();
    await expectError(insert(application, "status", "'realizada'"));
    await expectError(insert(application, "status, result", "'programada', 'paso'"));
    await expectError(insert(application, "status, result", "'no_asistio', 'paso'"));
    await insert(application, "status, result", "'realizada', 'paso'");
  });

  it("«no pasó» exige una nota de 3 caracteres o más", async () => {
    const application = await newApplication();
    await expectError(insert(application, "status, result", "'realizada', 'no_paso'"));
    await expectError(insert(application, "status, result, result_notes", "'realizada', 'no_paso', 'ab'"));
    await insert(application, "status, result, result_notes", "'realizada', 'no_paso', 'Sin perfil'");
  });

  it("«cancelada» exige motivo y se validan duración y largos", async () => {
    const application = await newApplication();
    await expectError(insert(application, "status", "'cancelada'"));
    await insert(application, "status, cancel_reason", "'cancelada', 'Ya no aplica'");
    await expectError(insert(application, "duration_minutes", "14"));
    await expectError(insert(application, "duration_minutes", "481"));
    await expectError(insert(application, "location", `'${"x".repeat(501)}'`));
    await expectError(insert(application, "interviewers", `'${"x".repeat(301)}'`));
    await expectError(insert(application, "instructions", `'${"x".repeat(2001)}'`));
    await expectError(insert(application, "result_notes", `'${"x".repeat(4001)}'`));
    await expectError(insert(application, "cancel_reason", `'${"x".repeat(501)}'`));
  });

  it("al borrar la postulación se borran sus entrevistas", async () => {
    const application = await newApplication();
    await schedule(application);
    await db.query("delete from public.applications where id = $1", [application]);
    const { rows } = await db.query("select 1 from public.interviews where application_id = $1", [application]);
    expect(rows).toHaveLength(0);
  });

  it("updated_at se actualiza al modificar", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    const before = (await interviewRow(id)).updated_at as unknown as string;
    await db.query("select pg_sleep(0.02)");
    await reschedule(id);
    expect(new Date((await interviewRow(id)).updated_at as unknown as string).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

describe("change_application_status (refactorizada)", () => {
  it("mantiene sus reglas: motivo, mismo estado y vacante archivada", async () => {
    const application = await newApplication();
    const change = (status: string, reason: string | null = null) =>
      asActor(db, rrhh(), () => db.query("select public.change_application_status($1, $2::public.application_status, $3)", [application, status, reason]));
    expect((await expectError(change("nuevo"))).message).toMatch(/ya se encuentra/);
    expect((await expectError(change("no_seleccionado"))).message).toMatch(/motivo/);
    await change("no_seleccionado", "Perfil distinto");
    expect(await statusOf(application)).toBe("no_seleccionado");
    expect((await events(application, ["cambio_estado"])).at(-1)).toMatchObject({
      from_status: "nuevo",
      to_status: "no_seleccionado",
      reason: "Perfil distinto",
      actor_id: ids.rrhh,
    });
    await expectError(asActor(db, anon, () => db.query("select public.change_application_status($1, 'retirado', 'x')", [application])));
  });
});

describe("auditoría", () => {
  it("registra altas y cambios de entrevistas con su responsable", async () => {
    const { rows } = await db.query<{ action: string; actor_id: string | null }>(
      "select action, actor_id from public.audit_logs where entity_type = 'interviews' order by id",
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("insert");
    expect(actions).toContain("update");
    expect(actions).toContain("delete");
    expect(rows.find((r) => r.action === "update")!.actor_id).toBe(ids.rrhh);
  });
});

describe("estado cerrado cancela las entrevistas programadas", () => {
  const autoReason = (label: string) => `Cancelada automáticamente: la postulación pasó a «${label}»`;

  it.each([
    ["seleccionado", "Seleccionado"],
    ["no_seleccionado", "No seleccionado"],
    ["retirado", "Retirado"],
  ])("change_application_status a %s", async (status, label) => {
    const application = await newApplication();
    const first = await schedule(application);
    const second = await schedule(application, { when: "2026-11-07T10:00:00-05:00" });
    const done = await schedule(application, { when: "2026-11-02T10:00:00-05:00" });
    await record(done, "no_asistio");
    await asActor(db, rrhh(), () =>
      db.query("select public.change_application_status($1, $2::public.application_status, 'Motivo de prueba')", [application, status]),
    );
    for (const id of [first, second]) {
      expect(await interviewRow(id)).toMatchObject({ status: "cancelada", cancel_reason: autoReason(label) });
    }
    // La que ya tenía resultado no se toca.
    expect((await interviewRow(done)).status).toBe("no_asistio");
    const cancelled = await events(application, ["entrevista_cancelada"]);
    expect(cancelled).toHaveLength(2);
    expect(cancelled[0]).toMatchObject({ reason: autoReason(label), actor_id: ids.rrhh });
    expect(await statusOf(application)).toBe(status);
  });

  it("no se cancelan al pasar a un estado abierto", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await asActor(db, rrhh(), () => db.query("select public.change_application_status($1, 'en_evaluacion')", [application]));
    expect((await interviewRow(id)).status).toBe("programada");
  });

  it("«no pasó» cancela las demás programadas y deja realizada la actual", async () => {
    const application = await newApplication();
    const current = await schedule(application);
    const other = await schedule(application, { when: "2026-11-08T10:00:00-05:00" });
    await record(current, "no_paso", "No cumple el perfil");
    expect(await interviewRow(current)).toMatchObject({ status: "realizada", result: "no_paso" });
    expect(await interviewRow(other)).toMatchObject({ status: "cancelada", cancel_reason: autoReason("No seleccionado") });
    expect(await events(application, ["entrevista_cancelada"])).toHaveLength(1);
    expect(await statusOf(application)).toBe("no_seleccionado");
  });

  it("«pasó» no cancela las demás", async () => {
    const application = await newApplication();
    const current = await schedule(application);
    const other = await schedule(application, { when: "2026-11-08T10:00:00-05:00" });
    await record(current, "paso");
    expect((await interviewRow(other)).status).toBe("programada");
  });
});

describe("reprogramar sobre postulaciones cerradas", () => {
  it("rechaza si la postulación está cerrada (aunque la entrevista siga programada)", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    // Fuerza el estado sin pasar por la función, para llegar a la validación.
    await db.query("update public.applications set status = 'retirado' where id = $1", [application]);
    expect((await interviewRow(id)).status).toBe("programada");
    expect((await expectError(reschedule(id))).message).toMatch(/cerrada/);
  });

  it("tras cerrarla por la vía normal la entrevista ya está cancelada y no se reprograma", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await asActor(db, rrhh(), () => db.query("select public.change_application_status($1, 'retirado', 'Desistió')", [application]));
    expect((await expectError(reschedule(id))).message).toMatch(/programada/);
  });

  it("rechaza si la vacante está archivada y cancelar sigue permitida", async () => {
    const vacancy = await createVacancy(db, { title: "Otra vacante que se archiva" });
    const application = await newApplication(vacancy);
    const id = await schedule(application);
    await db.query("update public.vacancies set status = 'archivada' where id = $1", [vacancy]);
    expect((await expectError(reschedule(id))).message).toMatch(/archivada/);
    await cancel(id, "La vacante se archivó");
    expect((await interviewRow(id)).status).toBe("cancelada");
  });

  it("cancelar sigue permitida con la postulación cerrada", async () => {
    const application = await newApplication();
    const id = await schedule(application);
    await db.query("update public.applications set status = 'no_seleccionado' where id = $1", [application]);
    await cancel(id, "Ya no corresponde");
    expect((await interviewRow(id)).status).toBe("cancelada");
  });
});
