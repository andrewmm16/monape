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
 * application_scorecards: cada evaluador crea/edita solo SU tarjeta; todo el
 * personal con acceso a la postulación ve las de los demás (para el consolidado).
 */
let db: PGlite;
let rrhhA: string;
let rrhhB: string;
let other: string;
let application: string;

const SCORES = JSON.stringify([{ competency: "tecnica", score: 4, comment: "" }]);

async function insertScorecard(actorId: string, evaluatorId: string) {
  return asActor(db, user(actorId), () =>
    db.query<{ id: string }>(
      `insert into public.application_scorecards (application_id, evaluator_id, recommendation, scores)
       values ($1, $2, 'avanza'::public.scorecard_recommendation, $3::jsonb) returning id`,
      [application, evaluatorId, SCORES],
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
});

afterAll(async () => {
  await db.close();
});

describe("application_scorecards RLS", () => {
  it("un evaluador crea su propia tarjeta", async () => {
    const { rows } = await insertScorecard(rrhhA, rrhhA);
    expect(rows).toHaveLength(1);
  });

  it("no puede crear una tarjeta a nombre de otra persona", async () => {
    const error = await expectError(insertScorecard(rrhhB, other));
    expect(error.message).toMatch(/row-level security|policy|política/i);
  });

  it("no admite dos tarjetas del mismo evaluador en la misma postulación", async () => {
    const error = await expectError(insertScorecard(rrhhA, rrhhA));
    expect(error.message).toMatch(/unique|duplicate|duplicad/i);
  });

  it("no puede editar la tarjeta de otro (RLS la oculta: 0 filas)", async () => {
    await insertScorecard(rrhhB, rrhhB);
    const updated = await asActor(db, user(rrhhA), () =>
      db.query<{ id: string }>(
        "update public.application_scorecards set recommendation = 'no_avanza' where evaluator_id = $1 returning id",
        [rrhhB],
      ),
    );
    expect(updated.rows).toHaveLength(0);
  });

  it("el personal ve todas las tarjetas de la postulación", async () => {
    const seen = await asActor(db, user(rrhhA), () =>
      db.query<{ id: string }>("select id from public.application_scorecards where application_id = $1", [application]),
    );
    expect(seen.rows).toHaveLength(2);
  });
});
