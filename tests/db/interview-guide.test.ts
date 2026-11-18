import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addRequirement,
  approveCriteria,
  asActor,
  createApplication,
  createCandidate,
  createTestDatabase,
  createUser,
  createVacancy,
  user,
} from "./harness";

/**
 * Guía de entrevista (20261118200100): cada ítem guarda la duda del motor
 * (signal) y la pregunta de la IA (interview_question); la anonimización borra
 * la pregunta, que puede citar el CV.
 */
let db: PGlite;
let rrhh: string;
let admin: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  admin = await createUser(db, "admin", "Admin Ficticio");
});

afterAll(async () => {
  await db?.close();
});

async function recordWith(item: Record<string, unknown>): Promise<{ applicationId: string; candidateId: string; evaluationId: string }> {
  const vacancyId = await createVacancy(db);
  const requirementId = await addRequirement(db, vacancyId, { description: "Gestión de planillas", weight: 5 });
  const criteria = await approveCriteria(db, vacancyId);
  const candidateId = await createCandidate(db, "Persona Ficticia Guía");
  const applicationId = await createApplication(db, candidateId, vacancyId);
  const items = [{ requirement_id: requirementId, assessment: "pendiente_verificacion", evidence: [], rationale: "Cargo parecido.", ...item }];
  const evaluationId = await asActor(db, user(rrhh), () =>
    db.query<{ id: string }>(
      `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v12', 'v1', null, 0, 100, 0,
         'pendiente'::public.compatibility_level, 'Resumen', array[]::text[], null, $3::jsonb) as id`,
      [applicationId, criteria, JSON.stringify(items)],
    ),
  ).then((r) => r.rows[0]!.id);
  return { applicationId, candidateId, evaluationId };
}

const stored = async (evaluationId: string) =>
  (
    await db.query<{ signal: string | null; interview_question: string | null }>(
      "select signal, interview_question from public.candidate_evaluation_items where evaluation_id = $1",
      [evaluationId],
    )
  ).rows[0]!;

describe("record_evaluation guarda la guía", () => {
  it("la duda del motor y la pregunta de la IA", async () => {
    const { evaluationId } = await recordWith({
      signal: "cargo_relacionado",
      interview_question: "  Como asistente de RRHH, ¿calculaba remuneraciones o CTS?  ",
    });
    expect(await stored(evaluationId)).toEqual({
      signal: "cargo_relacionado",
      interview_question: "Como asistente de RRHH, ¿calculaba remuneraciones o CTS?",
    });
  });

  it("valores con otro formato se ignoran y la pregunta se recorta a 500 caracteres", async () => {
    const { evaluationId } = await recordWith({ signal: "Duda; drop table", interview_question: "   " });
    expect(await stored(evaluationId)).toEqual({ signal: null, interview_question: null });

    const long = await recordWith({ interview_question: "¿".padEnd(800, "a") });
    expect((await stored(long.evaluationId)).interview_question).toHaveLength(500);
  });

  it("sin los campos, quedan vacíos (evaluaciones anteriores)", async () => {
    const { evaluationId } = await recordWith({});
    expect(await stored(evaluationId)).toEqual({ signal: null, interview_question: null });
  });
});

describe("anonymize_candidate", () => {
  it("borra la pregunta (puede citar el CV) y conserva la marca de duda", async () => {
    const { applicationId, candidateId, evaluationId } = await recordWith({
      signal: "nivel_inferior",
      interview_question: "Su CV dice Excel básico en Inka Software: ¿qué es lo más complejo que hizo?",
    });
    await asActor(db, user(rrhh), () => db.query("select public.change_application_status($1, 'no_seleccionado', 'Perfil distinto')", [applicationId]));
    await asActor(db, user(admin), () => db.query("select public.anonymize_candidate($1)", [candidateId]));
    expect(await stored(evaluationId)).toEqual({ signal: "nivel_inferior", interview_question: null });
  });
});
