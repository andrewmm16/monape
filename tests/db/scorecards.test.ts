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

/**
 * interview_scorecards: la valoración cuelga de cada ENTREVISTA. Cada evaluador
 * crea/edita solo SU tarjeta por entrevista; todo el personal con acceso la ve
 * (para el consolidado). Solo se evalúa una entrevista REALIZADA.
 */
let db: PGlite;
let rrhhA: string;
let rrhhB: string;
let other: string;
let application: string;
/** Entrevista realizada (evaluable) y una programada (no evaluable). */
let doneInterview: string;
let otherDoneInterview: string;
let pendingInterview: string;

const SCORES = JSON.stringify([{ competency: "tecnica", score: 4, comment: "" }]);

async function createInterview(status: "realizada" | "programada"): Promise<string> {
  const realizada = status === "realizada";
  const { rows } = await db.query<{ id: string }>(
    `insert into public.interviews (application_id, scheduled_at, duration_minutes, modality, status, result)
     values ($1, now(), 45, 'presencial', $2::public.interview_status, $3::public.interview_result)
     returning id`,
    [application, status, realizada ? "paso" : null],
  );
  return rows[0]!.id;
}

async function insertScorecard(actorId: string, evaluatorId: string, interviewId: string) {
  return asActor(db, user(actorId), () =>
    db.query<{ id: string }>(
      `insert into public.interview_scorecards (interview_id, evaluator_id, recommendation, scores)
       values ($1, $2, 'avanza'::public.scorecard_recommendation, $3::jsonb) returning id`,
      [interviewId, evaluatorId, SCORES],
    ),
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  rrhhA = await createUser(db, "rrhh", "RRHH A");
  rrhhB = await createUser(db, "rrhh", "RRHH B");
  other = await createUser(db, "rrhh", "RRHH C");
  const candidate = await createCandidate(db);
  const vacancy = await createVacancy(db);
  application = await createApplication(db, candidate, vacancy);
  doneInterview = await createInterview("realizada");
  otherDoneInterview = await createInterview("realizada");
  pendingInterview = await createInterview("programada");
});

afterAll(async () => {
  await db.close();
});

describe("interview_scorecards RLS", () => {
  it("un evaluador crea su propia tarjeta en una entrevista realizada", async () => {
    const { rows } = await insertScorecard(rrhhA, rrhhA, doneInterview);
    expect(rows).toHaveLength(1);
  });

  it("no puede crear una tarjeta a nombre de otra persona", async () => {
    const error = await expectError(insertScorecard(rrhhB, other, doneInterview));
    expect(error.message).toMatch(/row-level security|policy|política/i);
  });

  it("no admite dos tarjetas del mismo evaluador en la misma entrevista", async () => {
    const error = await expectError(insertScorecard(rrhhA, rrhhA, doneInterview));
    expect(error.message).toMatch(/unique|duplicate|duplicad/i);
  });

  it("no se puede evaluar una entrevista aún no realizada", async () => {
    const error = await expectError(insertScorecard(rrhhA, rrhhA, pendingInterview));
    expect(error.message).toMatch(/row-level security|policy|política/i);
  });

  it("el mismo evaluador sí puede evaluar otra entrevista del mismo candidato", async () => {
    const { rows } = await insertScorecard(rrhhA, rrhhA, otherDoneInterview);
    expect(rows).toHaveLength(1);
  });

  it("no puede editar la tarjeta de otro (RLS la oculta: 0 filas)", async () => {
    await insertScorecard(rrhhB, rrhhB, doneInterview);
    const updated = await asActor(db, user(rrhhA), () =>
      db.query<{ id: string }>(
        "update public.interview_scorecards set recommendation = 'no_avanza' where evaluator_id = $1 and interview_id = $2 returning id",
        [rrhhB, doneInterview],
      ),
    );
    expect(updated.rows).toHaveLength(0);
  });

  it("el personal ve todas las tarjetas de la entrevista", async () => {
    const seen = await asActor(db, user(rrhhA), () =>
      db.query<{ id: string }>("select id from public.interview_scorecards where interview_id = $1", [doneInterview]),
    );
    expect(seen.rows).toHaveLength(2);
  });
});
