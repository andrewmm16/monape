import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
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
 * Resultado del último aviso por correo a cada entrevistador
 * (interview_interviewer_notices, migración 20261121100000): solo lo escribe el
 * servidor (service_role) y lo lee quien accede a la entrevista.
 */
let db: PGlite;
let rrhh: string;
let caleta: string;
let interviewId: string;

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const record = (outcome: string, recipient = "Ana@Empresa.pe") =>
  asService(() => db.query("select public.record_interviewer_notice($1, $2, $3)", [interviewId, recipient, outcome]));

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH");
  caleta = await createUser(db, "reclutador_caleta", "Caleta");
  const applicationId = await createApplication(db, await createCandidate(db), await createVacancy(db));
  const { rows } = await asActor(db, user(rrhh), () =>
    db.query<{ id: string }>(
      "select public.schedule_interview($1, now() + interval '2 days', 45, 'virtual', 'https://meet.example/x') as id",
      [applicationId],
    ),
  );
  interviewId = rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

describe("avisos a entrevistadores", () => {
  it("el servidor guarda el resultado (correo en minúsculas) y un envío nuevo lo reemplaza", async () => {
    await record("no_enviado");
    await record("enviado");
    const { rows } = await db.query<{ recipient: string; outcome: string }>(
      "select recipient, outcome from public.interview_interviewer_notices where interview_id = $1",
      [interviewId],
    );
    expect(rows).toEqual([{ recipient: "ana@empresa.pe", outcome: "enviado" }]);
  });

  it("rechaza un resultado desconocido", async () => {
    await expectError(record("entregado"));
  });

  it("nadie más que el servidor puede escribirlo", async () => {
    await expectError(
      asActor(db, user(rrhh), () =>
        db.query("select public.record_interviewer_notice($1, 'x@empresa.pe', 'enviado')", [interviewId]),
      ),
    );
    await expectError(
      asActor(db, anon, () => db.query("select public.record_interviewer_notice($1, 'x@empresa.pe', 'enviado')", [interviewId])),
    );
    await expectError(
      asActor(db, user(rrhh), () =>
        db.query("insert into public.interview_interviewer_notices (interview_id, recipient, outcome) values ($1, 'y@empresa.pe', 'enviado')", [
          interviewId,
        ]),
      ),
    );
  });

  it("lo lee quien accede a la entrevista, no otros roles", async () => {
    const rrhhSees = await asActor(db, user(rrhh), () =>
      db.query("select * from public.interview_interviewer_notices where interview_id = $1", [interviewId]),
    );
    expect(rrhhSees.rows).toHaveLength(1);
    const caletaSees = await asActor(db, user(caleta), () => db.query("select * from public.interview_interviewer_notices"));
    expect(caletaSees.rows).toHaveLength(0);
  });
});
