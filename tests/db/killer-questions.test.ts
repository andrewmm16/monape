import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createTestDatabase, createUser, expectError, user } from "./harness";

let db: PGlite;
let admin: string;
let noticeId: string;
let vacancyId: string;
let code: string;
let qSiNo: string;
let qNum: string;
let qOpt: string;

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin Ficticio");
  const notice = await asActor(db, user(admin), () =>
    db.query<{ id: string }>("insert into public.privacy_notices (title, body) values ('Aviso', 'Texto.') returning id"),
  );
  noticeId = notice.rows[0]!.id;
  await asActor(db, user(admin), () => db.query("select public.activate_privacy_notice($1, 'Acta ficticia')", [noticeId]));

  const v = await db.query<{ id: string; public_code: string }>(
    `insert into public.vacancies (title, department, description, city, region, employment_type, modality, status)
     values ('Chofer', 'Logística', $1, 'Lima', 'Lima', 'tiempo_completo', 'presencial', 'publicada')
     returning id, public_code`,
    ["Descripción ficticia de la vacante con más de cincuenta caracteres en total."],
  );
  vacancyId = v.rows[0]!.id;
  code = v.rows[0]!.public_code;

  const insert = async (sql: string, params: unknown[]) => (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
  qSiNo = await insert(
    `insert into public.vacancy_killer_questions (vacancy_id, question, question_type, expected_boolean, position)
     values ($1, '¿Cuenta con licencia A-II?', 'si_no', true, 0) returning id`,
    [vacancyId],
  );
  qNum = await insert(
    `insert into public.vacancy_killer_questions (vacancy_id, question, question_type, comparator, threshold, is_required, position)
     values ($1, '¿Años conduciendo?', 'numero', 'mayor_igual', 2, false, 1) returning id`,
    [vacancyId],
  );
  qOpt = await insert(
    `insert into public.vacancy_killer_questions (vacancy_id, question, question_type, options, accepted_options, position)
     values ($1, '¿Dónde vive?', 'opcion_unica', array['Lima','Callao','Otra'], array['Lima','Callao'], 2) returning id`,
    [vacancyId],
  );
});

afterAll(async () => {
  await db?.close();
});

function submit(answers: unknown) {
  const candidateId = randomUUID();
  const resumeId = randomUUID();
  return asService(() =>
    db.query<{ application_id: string; public_reference: string }>(
      `select * from public.submit_online_application(
         $1, $2::uuid, 'Página de empleos', false, $3::uuid, $4::uuid, $5, 'Lucía Ficticia', $6, '999111222', null, null,
         'cv.pdf', 'application/pdf', 1000, $7,
         'completada', 'pdf_text', 'extractor-v1', 'Texto ficticio.', '{}'::jsonb, '{}', null, $8::jsonb)`,
      [
        code,
        noticeId,
        candidateId,
        resumeId,
        `candidates/${candidateId}/${resumeId}.pdf`,
        `${randomUUID().slice(0, 8)}@correo.test`,
        createHash("sha256").update(randomUUID()).digest("hex"),
        JSON.stringify(answers),
      ],
    ),
  );
}

describe("preguntas eliminatorias", () => {
  it("la función pública expone las preguntas sin revelar qué respuesta cumple", async () => {
    const { rows } = await asService(() => db.query<Record<string, unknown>>("select * from public.public_killer_questions($1)", [code]));
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0]!).sort()).toEqual(["help_text", "id", "is_required", "options", "question", "question_type"]);
    expect(rows.find((r) => r.question_type === "si_no")!.options).toBeNull();
    expect(rows.find((r) => r.question_type === "opcion_unica")!.options).toEqual(["Lima", "Callao", "Otra"]);
  });

  it("solo service_role puede ejecutarla", async () => {
    await db.exec("set role anon");
    try {
      const error = await expectError(db.query("select * from public.public_killer_questions($1)", [code]));
      expect(error.message).toMatch(/permission denied/i);
    } finally {
      await db.exec("reset role");
    }
  });

  it("registra las respuestas, calcula meets y NO cambia el estado aunque no cumplan", async () => {
    const { rows } = await submit([
      { question_id: qSiNo, answer_boolean: false },
      { question_id: qNum, answer_number: 5 },
      { question_id: qOpt, answer_text: "Otra" },
    ]);
    const applicationId = rows[0]!.application_id;
    const answers = await db.query<{ question_id: string; meets: boolean }>(
      "select question_id, meets from public.application_killer_answers where application_id = $1",
      [applicationId],
    );
    const meets = Object.fromEntries(answers.rows.map((r) => [r.question_id, r.meets]));
    expect(meets).toEqual({ [qSiNo]: false, [qNum]: true, [qOpt]: false });
    const app = await db.query<{ status: string }>("select status from public.applications where id = $1", [applicationId]);
    expect(app.rows[0]!.status).toBe("nuevo");
  });

  it("sin respuestas la postulación se registra igual", async () => {
    const { rows } = await submit([]);
    expect(rows[0]!.public_reference).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("una respuesta inválida revierte toda la postulación", async () => {
    const before = (await db.query<{ n: number }>("select count(*)::int as n from public.applications")).rows[0]!.n;
    const error = await expectError(submit([{ question_id: qOpt, answer_text: "Marte" }]));
    expect(error.message).toMatch(/no es válida/i);
    const after = (await db.query<{ n: number }>("select count(*)::int as n from public.applications")).rows[0]!.n;
    expect(after).toBe(before);
  });

  it("carrera: una respuesta con pregunta inexistente se omite y la postulación NO se pierde", async () => {
    const { rows } = await submit([
      { question_id: randomUUID(), answer_boolean: true },
      { question_id: qSiNo, answer_boolean: true },
    ]);
    const applicationId = rows[0]!.application_id;
    const answers = await db.query<{ question_id: string }>(
      "select question_id from public.application_killer_answers where application_id = $1",
      [applicationId],
    );
    expect(answers.rows.map((r) => r.question_id)).toEqual([qSiNo]);
  });

  it("editar la condición de una pregunta recalcula el meets de las respuestas guardadas", async () => {
    const { rows } = await submit([{ question_id: qNum, answer_number: 3 }]);
    const applicationId = rows[0]!.application_id;
    const meets = async () =>
      (
        await db.query<{ meets: boolean }>(
          "select meets from public.application_killer_answers where application_id = $1 and question_id = $2",
          [applicationId, qNum],
        )
      ).rows[0]!.meets;
    expect(await meets()).toBe(true); // 3 >= 2
    await db.query("update public.vacancy_killer_questions set threshold = 5 where id = $1", [qNum]);
    expect(await meets()).toBe(false); // 3 >= 5
    await db.query("update public.vacancy_killer_questions set comparator = 'menor_igual' where id = $1", [qNum]);
    expect(await meets()).toBe(true); // 3 <= 5
    await db.query("update public.vacancy_killer_questions set threshold = 2, comparator = 'mayor_igual' where id = $1", [qNum]);
  });
});
