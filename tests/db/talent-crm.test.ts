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
 * CRM de talentos: etiquetas compartidas (talent_tags / candidate_tags) y el RPC
 * add_candidate_to_vacancy (reactivar un candidato del histórico sin duplicar).
 */
let db: PGlite;
let rrhh: string;
let candidate: string;
let vacancy: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH");
  candidate = await createCandidate(db);
  vacancy = await createVacancy(db);
});

afterAll(async () => {
  await db.close();
});

async function createTag(name: string) {
  return asActor(db, user(rrhh), () =>
    db.query<{ id: string }>(
      "insert into public.talent_tags (name, created_by) values ($1, $2) returning id",
      [name, rrhh],
    ),
  );
}

describe("talent_tags", () => {
  it("el personal crea una etiqueta y la ve", async () => {
    const { rows } = await createTag("Finalista");
    expect(rows).toHaveLength(1);
    const seen = await asActor(db, user(rrhh), () =>
      db.query("select id from public.talent_tags where id = $1", [rows[0]!.id]),
    );
    expect(seen.rows).toHaveLength(1);
  });

  it("no admite nombres duplicados sin distinguir mayúsculas", async () => {
    const error = await expectError(createTag("  finalista "));
    expect(error.message).toMatch(/unique|duplicate|duplicad/i);
  });

  it("asigna una etiqueta a un candidato y no la duplica", async () => {
    const { rows } = await createTag("Recontratar");
    const tagId = rows[0]!.id;
    const assign = () =>
      asActor(db, user(rrhh), () =>
        db.query("insert into public.candidate_tags (candidate_id, tag_id, assigned_by) values ($1, $2, $3)", [
          candidate,
          tagId,
          rrhh,
        ]),
      );
    await assign();
    const error = await expectError(assign());
    expect(error.message).toMatch(/unique|duplicate|duplicad/i);
  });
});

describe("add_candidate_to_vacancy", () => {
  const reactivate = (candidateId: string, vacancyId: string) =>
    asActor(db, user(rrhh), () =>
      db.query<{ add_candidate_to_vacancy: string }>("select public.add_candidate_to_vacancy($1, $2)", [
        candidateId,
        vacancyId,
      ]),
    );

  it("reactiva: crea la postulación con origen 'cartera' en estado 'nuevo'", async () => {
    const freshCandidate = await createCandidate(db, "Reactivable");
    const otherVacancy = await createVacancy(db, { title: "Analista contable" });
    const result = await reactivate(freshCandidate, otherVacancy);
    const applicationId = result.rows[0]!.add_candidate_to_vacancy;
    expect(applicationId).toBeTruthy();
    const { rows } = await db.query<{ status: string; intake_method: string }>(
      "select status, intake_method from public.applications where id = $1",
      [applicationId],
    );
    expect(rows[0]).toMatchObject({ status: "nuevo", intake_method: "cartera" });
  });

  it("no duplica si el candidato ya postuló a esa vacante", async () => {
    const cand = await createCandidate(db, "Ya postuló");
    const dupVacancy = await createVacancy(db, { title: "Vacante con postulación" });
    await createApplication(db, cand, dupVacancy);
    const error = await expectError(reactivate(cand, dupVacancy));
    expect(error.message).toMatch(/ya tiene una postulación/i);
  });

  it("no reactiva si el candidato sigue en proceso en otra vacante", async () => {
    const cand = await createCandidate(db, "En proceso");
    const activeVacancy = await createVacancy(db, { title: "Proceso activo" });
    const targetVacancy = await createVacancy(db, { title: "Nueva vacante" });
    await createApplication(db, cand, activeVacancy); // queda 'nuevo' = en proceso
    const error = await expectError(reactivate(cand, targetVacancy));
    expect(error.message).toMatch(/ya está en proceso/i);
  });

  it("falla si el candidato no existe", async () => {
    const error = await expectError(reactivate("00000000-0000-0000-0000-000000000000", vacancy));
    expect(error.message).toMatch(/no existe/i);
  });
});
