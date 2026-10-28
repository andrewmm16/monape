import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { anon, asActor, createTestDatabase, createUser, expectError, user } from "./harness";

let db: PGlite;
let admin: string;
let rrhh: string;
let noticeId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin Ficticio");
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  noticeId = await activateNotice();
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

/** Crea y activa un aviso (retira el vigente) y devuelve su id. */
async function activateNotice(): Promise<string> {
  const { rows } = await asActor(db, user(admin), () =>
    db.query<{ id: string }>("insert into public.privacy_notices (title, body) values ('Aviso de prueba', 'Texto.') returning id"),
  );
  await asActor(db, user(admin), () => db.query("select public.activate_privacy_notice($1, 'Acta ficticia')", [rows[0]!.id]));
  return rows[0]!.id;
}

const sha = (seed: string = randomUUID()) => createHash("sha256").update(seed).digest("hex");
const LONG_DESCRIPTION = "Descripción ficticia de la vacante con más de cincuenta caracteres en total.";

async function limaToday(offsetDays: number): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    "select (((now() at time zone 'America/Lima')::date) + $1::int)::text as d",
    [offsetDays],
  );
  return rows[0]!.d;
}

type VacancyOptions = { status?: string; confidential?: boolean; closingDate?: string | null; complete?: boolean };

async function createPublished(options: VacancyOptions = {}): Promise<{ id: string; code: string }> {
  const { rows } = await db.query<{ id: string; public_code: string }>(
    `insert into public.vacancies
       (title, department, description, city, region, employment_type, modality, is_confidential, closing_date, status)
     values ('Analista de datos', 'Operaciones', $1, $2, $2, $3::public.employment_type, 'hibrido', $4, $5::date, 'publicada')
     returning id, public_code`,
    [
      LONG_DESCRIPTION,
      options.complete === false ? null : "Lima",
      options.complete === false ? null : "tiempo_completo",
      options.confidential ?? false,
      options.closingDate ?? null,
    ],
  );
  const { id, public_code: code } = rows[0]!;
  if (options.status && options.status !== "publicada") {
    await db.query("update public.vacancies set status = $2::public.vacancy_status where id = $1", [id, options.status]);
  }
  return { id, code };
}

type Submission = Partial<{
  notice: string;
  portal: string;
  talentPool: boolean;
  candidateId: string;
  resumeId: string;
  fullName: string;
  email: string;
  phone: string | null;
  city: string | null;
  linkedin: string | null;
  sha256: string;
}>;

function submit(code: string, submission: Submission = {}) {
  const candidateId = submission.candidateId ?? randomUUID();
  const resumeId = submission.resumeId ?? randomUUID();
  return asService(() =>
    db.query<{ application_id: string; public_reference: string }>(
      `select * from public.submit_online_application(
         $1, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7, $8, $9, $10, $11, $12,
         'cv.pdf', 'application/pdf', 1000, $13,
         'completada', 'pdf_text', 'extractor-v1', 'Texto ficticio del CV con experiencia en SQL.', '{}'::jsonb, '{}', null)`,
      [
        code,
        submission.notice ?? noticeId,
        submission.portal ?? "Página de empleos",
        submission.talentPool ?? false,
        candidateId,
        resumeId,
        `candidates/${candidateId}/${resumeId}.pdf`,
        submission.fullName ?? "Lucía Ramos Ficticia",
        submission.email ?? `${randomUUID().slice(0, 8)}@correo.test`,
        submission.phone === undefined ? `9${Math.floor(10_000_000 + Math.random() * 89_999_999)}` : submission.phone,
        submission.city === undefined ? null : submission.city,
        submission.linkedin === undefined ? null : submission.linkedin,
        submission.sha256 ?? sha(),
      ],
    ),
  );
}

const count = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`, params)).rows[0]!.n;

async function snapshot() {
  return {
    candidates: await count("select 1 from public.candidates"),
    resumes: await count("select 1 from public.resumes"),
    extractions: await count("select 1 from public.resume_extractions"),
    applications: await count("select 1 from public.applications"),
    consents: await count("select 1 from public.consent_records"),
    events: await count("select 1 from public.application_events"),
    audits: await count("select 1 from public.audit_logs where action = 'formulario_postulacion'"),
  };
}

const NEW_FUNCTIONS = ["consume_public_rate_limit", "consume_form_challenge", "submit_online_application"];

describe("privilegios", () => {
  it("solo service_role ejecuta las funciones nuevas", async () => {
    const { rows } = await db.query<{ proname: string; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [NEW_FUNCTIONS],
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row, row.proname).toMatchObject({ anon: false, authenticated: false, service: true });
  });

  it("anon y un usuario autenticado reciben «permission denied» al llamarlas", async () => {
    const { code } = await createPublished();
    const calls = [
      `select public.consume_public_rate_limit('${"a".repeat(64)}', '${code}')`,
      `select public.consume_form_challenge('${"b".repeat(64)}')`,
      `select * from public.submit_online_application('${code}', gen_random_uuid(), 'Google', false, gen_random_uuid(), gen_random_uuid(),
         'candidates/x/y.pdf', 'Nombre', 'a@b.cd', '999', null, null, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
         'completada', 'pdf_text', 'v', null, '{}'::jsonb, '{}', null)`,
    ];
    for (const sql of calls) {
      for (const actor of [anon, user(rrhh), user(admin)]) {
        const error = await asActor(db, actor, () => expectError(db.query(sql)));
        expect(error.message, sql).toMatch(/permission denied/);
      }
    }
  });

  it("el helper privado de duplicados no lo ejecuta nadie más que el propietario", async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
      `select has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname = 'duplicate_reasons'`,
    );
    expect(rows).toEqual([{ anon: false, authenticated: false, service: false }]);
  });

  it("public_form_challenges y las columnas nuevas de applications no se leen ni escriben desde la API", async () => {
    for (const actor of [anon, user(rrhh)]) {
      const error = await asActor(db, actor, () => expectError(db.query("select * from public.public_form_challenges")));
      expect(error.message).toMatch(/permission denied/);
      const insert = await asActor(db, actor, () =>
        expectError(db.query(`insert into public.public_form_challenges (challenge_hash) values ('${"c".repeat(64)}')`)),
      );
      expect(insert.message).toMatch(/permission denied/);
    }
    const { code } = await createPublished();
    const { rows } = await submit(code);
    const applicationId = rows[0]!.application_id;
    for (const sql of [
      "update public.applications set public_reference = 'ZZZZZZZZ' where id = $1",
      "update public.applications set possible_duplicate_reasons = '{cv}' where id = $1",
    ]) {
      const error = await asActor(db, user(rrhh), () => expectError(db.query(sql, [applicationId])));
      expect(error.message).toMatch(/permission denied/);
    }
    // Ni siquiera al crearla.
    const insert = await asActor(db, user(rrhh), () =>
      expectError(
        db.query(
          `insert into public.applications (candidate_id, vacancy_id, public_reference)
           select candidate_id, vacancy_id, 'ABCDEFGH' from public.applications where id = $1`,
          [applicationId],
        ),
      ),
    );
    expect(insert.message).toMatch(/permission denied/);
  });
});

describe("submit_online_application: registro", () => {
  it("crea candidato nuevo, CV, postulación `nuevo`, evento sin actor, dos constancias y auditoría sin datos personales", async () => {
    const { id: vacancyId, code } = await createPublished();
    const fullName = "Nombre Secreto Ficticio";
    const email = "correo.secreto@correo.test";
    const { rows } = await submit(code, {
      fullName,
      email,
      phone: "+51 944 555 666",
      city: "Arequipa",
      linkedin: "https://www.linkedin.com/in/ficticio",
      talentPool: true,
      portal: "Google",
    });
    expect(rows).toHaveLength(1);
    const { application_id: applicationId, public_reference: reference } = rows[0]!;
    expect(reference).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

    const application = await db.query<Record<string, unknown>>(
      `select a.status, a.intake_method, p.name as portal, a.public_reference, a.possible_duplicate_reasons as dup,
              c.source, c.source_detail, c.field_origins as origins, c.location, c.linkedin_url, c.created_by,
              a.vacancy_id, a.resume_id
         from public.applications a
         join public.job_portals p on p.id = a.portal_id
         join public.candidates c on c.id = a.candidate_id
        where a.id = $1`,
      [applicationId],
    );
    expect(application.rows[0]).toMatchObject({
      status: "nuevo",
      intake_method: "formulario_en_linea",
      portal: "Google",
      public_reference: reference,
      dup: [],
      source: "bolsa_empleo",
      source_detail: "Google",
      origins: { full_name: "declarado", email: "declarado", phone: "declarado", location: "declarado", linkedin_url: "declarado" },
      location: "Arequipa",
      linkedin_url: "https://www.linkedin.com/in/ficticio",
      created_by: null,
      vacancy_id: vacancyId,
    });
    expect(application.rows[0]!.resume_id).not.toBeNull();
    expect(
      await count("select 1 from public.resume_extractions e where e.resume_id = $1", [application.rows[0]!.resume_id]),
    ).toBe(1);

    const events = await db.query<{ event_type: string; actor_id: string | null; to_status: string }>(
      "select event_type, actor_id, to_status from public.application_events where application_id = $1",
      [applicationId],
    );
    expect(events.rows).toEqual([{ event_type: "postulacion_creada", actor_id: null, to_status: "nuevo" }]);

    const consents = await db.query<{ purpose: string; granted: boolean; method: string; recorded_by: string | null; notice_id: string }>(
      "select purpose, granted, method, recorded_by, notice_id from public.consent_records where application_id = $1 order by purpose::text",
      [applicationId],
    );
    expect(consents.rows).toEqual([
      { purpose: "cartera_talento", granted: true, method: "formulario_en_linea", recorded_by: null, notice_id: noticeId },
      { purpose: "proceso_seleccion", granted: true, method: "formulario_en_linea", recorded_by: null, notice_id: noticeId },
    ]);

    const audit = await db.query<{ actor_id: string | null; metadata: Record<string, unknown> }>(
      "select actor_id, metadata from public.audit_logs where action = 'formulario_postulacion' and entity_id = $1",
      [applicationId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_id).toBeNull();
    expect(audit.rows[0]!.metadata).toMatchObject({ intake_method: "formulario_en_linea", portal: "Google", talent_pool: true });
    const everyAuditRow = JSON.stringify((await db.query("select * from public.audit_logs")).rows);
    for (const secret of [fullName, email, "944 555 666", "Arequipa", "linkedin.com"]) expect(everyAuditRow).not.toContain(secret);
  });

  it("la constancia de cartera de talento refleja la casilla (rechazada = granted false)", async () => {
    const { code } = await createPublished();
    const { rows } = await submit(code, { talentPool: false });
    const consents = await db.query<{ purpose: string; granted: boolean }>(
      "select purpose, granted from public.consent_records where application_id = $1 order by purpose::text",
      [rows[0]!.application_id],
    );
    expect(consents.rows).toEqual([
      { purpose: "cartera_talento", granted: false },
      { purpose: "proceso_seleccion", granted: true },
    ]);
  });

  it("ciudad y LinkedIn son opcionales y no aparecen en field_origins si faltan", async () => {
    const { code } = await createPublished();
    const { rows } = await submit(code, { city: "  ", linkedin: null });
    const candidate = await db.query<{ location: string | null; linkedin_url: string | null; origins: Record<string, string> }>(
      `select c.location, c.linkedin_url, c.field_origins as origins from public.candidates c
         join public.applications a on a.candidate_id = c.id where a.id = $1`,
      [rows[0]!.application_id],
    );
    expect(candidate.rows[0]!.location).toBeNull();
    expect(candidate.rows[0]!.linkedin_url).toBeNull();
    expect(Object.keys(candidate.rows[0]!.origins).sort()).toEqual(["email", "full_name", "phone"]);
  });

  it("siempre crea un candidato nuevo: no modifica fichas existentes con el mismo correo", async () => {
    const { code } = await createPublished();
    const email = `repetido.${randomUUID().slice(0, 8)}@correo.test`;
    await db.query("insert into public.candidates (id, full_name, email) values (gen_random_uuid(), 'Persona Previa', $1)", [email]);
    const before = await db.query("select id, full_name, email, phone, location, updated_at from public.candidates where full_name = 'Persona Previa' and email = $1", [email]);
    await submit(code, { email, fullName: "Otra Persona Ficticia" });
    const after = await db.query("select id, full_name, email, phone, location, updated_at from public.candidates where full_name = 'Persona Previa' and email = $1", [email]);
    expect(after.rows).toEqual(before.rows);
    expect(await count("select 1 from public.candidates where email = $1", [email])).toBe(2);
  });

  it("las referencias públicas son únicas", async () => {
    const { code } = await createPublished();
    const references = new Set<string>();
    for (let i = 0; i < 15; i++) references.add((await submit(code)).rows[0]!.public_reference);
    expect(references.size).toBe(15);
  });

  it("restricciones de public_reference: formato y sin duplicados", async () => {
    const { code } = await createPublished();
    const { rows } = await submit(code);
    const otherId = (await submit(code)).rows[0]!.application_id;
    for (const bad of ["abcdefgh", "ABCDEFG", "ABCDEFGHI", "ABCDEFG0", "ABCDEFGI", "ABCDEFGO"]) {
      const error = await expectError(db.query("update public.applications set public_reference = $1 where id = $2", [bad, otherId]));
      expect(error.message, bad).toMatch(/check/);
    }
    const dup = await expectError(
      db.query("update public.applications set public_reference = (select public_reference from public.applications where id = $1) where id = $2", [
        rows[0]!.application_id,
        otherId,
      ]),
    );
    expect(dup.message).toMatch(/unique|duplicate/);
  });
});

describe("submit_online_application: rechazos", () => {
  async function expectRejected(code: string, submission: Submission, errcode: RegExp | string) {
    const before = await snapshot();
    const error = await expectError(submit(code, submission));
    expect(error.message).toMatch(errcode);
    expect(await snapshot()).toEqual(before);
    return error as Error & { code?: string };
  }

  it("vacante inexistente, confidencial, en borrador, sin datos públicos: RH404", async () => {
    const confidential = await createPublished({ confidential: true });
    const incomplete = await createPublished({ complete: false });
    const draft = await createPublished();
    await db.query("update public.vacancies set status = 'borrador' where id = $1", [draft.id]);
    for (const code of ["zzzzzzzzzz", confidential.code, incomplete.code, draft.code]) {
      const error = await expectRejected(code, {}, /La vacante no existe/);
      expect(error.code ?? (error as { code?: string }).code).toBe("RH404");
    }
  });

  it("vacante cerrada o con fecha de cierre vencida (hora de Lima): RH409", async () => {
    const closed = await createPublished({ status: "cerrada" });
    const expired = await createPublished({ closingDate: await limaToday(-1) });
    for (const code of [closed.code, expired.code]) {
      const error = await expectRejected(code, {}, /ya no recibe postulaciones/);
      expect(error.code).toBe("RH409");
    }
  });

  it("acepta una vacante cuyo cierre es hoy", async () => {
    const { code } = await createPublished({ closingDate: await limaToday(0) });
    expect((await submit(code)).rows).toHaveLength(1);
  });

  it("aviso no vigente, retirado o inexistente: RH412", async () => {
    const { code } = await createPublished();
    const old = noticeId;
    const current = await activateNotice();
    expect(current).not.toBe(old);
    const draft = (
      await asActor(db, user(admin), () =>
        db.query<{ id: string }>("insert into public.privacy_notices (title, body) values ('Borrador', 'x') returning id"),
      )
    ).rows[0]!.id;
    for (const notice of [old, draft, randomUUID()]) {
      const error = await expectRejected(code, { notice }, /aviso de privacidad cambió/);
      expect(error.code).toBe("RH412");
    }
    noticeId = current;
    expect((await submit(code, { notice: current })).rows).toHaveLength(1);
  });

  it("portal fuera de «Página de empleos» y «Google», o inactivo: RH422", async () => {
    const { code } = await createPublished();
    await expectRejected(code, { portal: "Talent.com" }, /Portal no válido/);
    await expectRejected(code, { portal: "Inventado" }, /Portal no válido/);
    await db.query("update public.job_portals set is_active = false where name = 'Google'");
    await expectRejected(code, { portal: "Google" }, /no está disponible/);
    await db.query("update public.job_portals set is_active = true where name = 'Google'");
    expect((await submit(code, { portal: "Google" })).rows).toHaveLength(1);
  });

  it("si un paso falla (CV con hash inválido) no queda nada registrado", async () => {
    const { code } = await createPublished();
    await expectRejected(code, { sha256: "no-es-un-hash" }, /check|violates/);
  });

  it("si falla el último paso (constancias) se deshace todo", async () => {
    const { code } = await createPublished();
    const before = await snapshot();
    // Una constancia imposible: el aviso desaparece entre la comprobación y el registro.
    await db.query(`create function public.__test_fail_consent() returns trigger language plpgsql as $$ begin raise exception 'fallo simulado'; end $$`);
    await db.query("create trigger __test_fail_consent before insert on public.consent_records for each row execute function public.__test_fail_consent()");
    try {
      const error = await expectError(submit(code));
      expect(error.message).toMatch(/fallo simulado/);
    } finally {
      await db.query("drop trigger __test_fail_consent on public.consent_records");
      await db.query("drop function public.__test_fail_consent()");
    }
    expect(await snapshot()).toEqual(before);
  });

  it("un teléfono o correo inválido hace fallar la transacción completa", async () => {
    const { code } = await createPublished();
    await expectRejected(code, { email: "sin-arroba" }, /check|violates/);
    await expectRejected(code, { fullName: "A" }, /check|violates/);
  });
});

describe("motivos de posible duplicado", () => {
  it("correo, teléfono y CV iguales a los de otro candidato; nunca fusiona", async () => {
    const { code } = await createPublished();
    const email = `dup.${randomUUID().slice(0, 8)}@correo.test`;
    const phone = `9${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const hash = sha();
    const first = (await submit(code, { email, phone, sha256: hash })).rows[0]!.application_id;
    const reasons = async (id: string) =>
      (await db.query<{ r: string[] }>("select possible_duplicate_reasons as r from public.applications where id = $1", [id])).rows[0]!.r;
    expect(await reasons(first)).toEqual([]);

    const sameEmail = (await submit(code, { email: email.toUpperCase() })).rows[0]!.application_id;
    expect(await reasons(sameEmail)).toEqual(["correo"]);
    const samePhone = (await submit(code, { phone: `+51 ${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}` })).rows[0]!.application_id;
    expect(await reasons(samePhone)).toEqual(["telefono"]);
    const sameCv = (await submit(code, { sha256: hash })).rows[0]!.application_id;
    expect(await reasons(sameCv)).toEqual(["cv"]);
    const all = (await submit(code, { email, phone, sha256: hash })).rows[0]!.application_id;
    expect(await reasons(all)).toEqual(["correo", "telefono", "cv"]);
    expect(await count("select 1 from public.candidates where email_normalized = $1", [email])).toBeGreaterThanOrEqual(3);
  });

  it("la vista application_overview los lee de applications", async () => {
    const { rows } = await db.query<{ possible_duplicate_reasons: string[]; portal_name: string; intake_method: string }>(
      `select o.possible_duplicate_reasons, o.portal_name, o.intake_method
         from public.application_overview o
        where o.intake_method = 'formulario_en_linea' and o.possible_duplicate_reasons @> array['correo','telefono','cv']`,
    );
    expect(rows[0]).toEqual({
      possible_duplicate_reasons: ["correo", "telefono", "cv"],
      portal_name: "Página de empleos",
      intake_method: "formulario_en_linea",
    });
  });

  it("restricción: solo correo, telefono y cv", async () => {
    const error = await expectError(db.query("update public.applications set possible_duplicate_reasons = '{nombre}' where id = (select id from public.applications limit 1)"));
    expect(error.message).toMatch(/check/);
  });

  it("register_integration_application sigue rellenando los motivos (regresión de 2.10)", async () => {
    const { code } = await createPublished();
    const email = `ta.${randomUUID().slice(0, 8)}@correo.test`;
    const hash = sha();
    await submit(code, { email, sha256: hash });
    const candidateId = randomUUID();
    const resumeId = randomUUID();
    const externalId = `ta-${randomUUID()}`;
    const { rows } = await asService(() =>
      db.query<{ application_id: string }>(
        `select * from public.register_integration_application(
           'talent_apply', $1, $2, $3::uuid, $4::uuid, $5, 'Persona Talent', $6, null, 'cv.pdf', 'application/pdf', 1000, $7,
           'completada', 'pdf_text', 'extractor-v1', 'Texto del CV', '{}'::jsonb, '{}', null)`,
        [externalId, code, candidateId, resumeId, `candidates/${candidateId}/${resumeId}.pdf`, email, hash],
      ),
    );
    const application = await db.query<{ r: string[]; intake_method: string }>(
      "select possible_duplicate_reasons as r, intake_method from public.applications where id = $1",
      [rows[0]!.application_id],
    );
    expect(application.rows[0]).toEqual({ r: ["correo", "cv"], intake_method: "integracion" });
    const submission = await db.query<{ duplicate_reasons: string[] }>(
      "select duplicate_reasons from public.integration_submissions where external_id = $1",
      [externalId],
    );
    expect(submission.rows[0]!.duplicate_reasons).toEqual(["correo", "cv"]);
    // Una repetición no cambia nada.
    const again = await asService(() =>
      db.query<{ already_registered: boolean }>(
        `select * from public.register_integration_application(
           'talent_apply', $1, $2, gen_random_uuid(), gen_random_uuid(), 'candidates/x/y.pdf', 'Persona Talent', $3, null,
           'cv.pdf', 'application/pdf', 1000, $4, 'completada', 'pdf_text', 'extractor-v1', 'T', '{}'::jsonb, '{}', null)`,
        [externalId, code, email, hash],
      ),
    );
    expect(again.rows[0]!.already_registered).toBe(true);
  });

  it("private.duplicate_reasons ignora al candidato excluido y valores nulos", async () => {
    const { rows } = await db.query<{ r: string[] }>(
      "select private.duplicate_reasons(null, null, null, gen_random_uuid()) as r",
    );
    expect(rows[0]!.r).toEqual([]);
  });
});

describe("vista application_overview", () => {
  it("conserva security_invoker, los permisos y la posición de possible_duplicate_reasons (última columna)", async () => {
    const options = await db.query<{ reloptions: string[] | null }>(
      "select c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'application_overview'",
    );
    expect(options.rows[0]!.reloptions).toContain("security_invoker=true");
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'application_overview' order by ordinal_position`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names.slice(-4)).toEqual(["portal_name", "intake_method", "portal_id", "possible_duplicate_reasons"]);
    expect(names.at(-1)).toBe("possible_duplicate_reasons");
    const anonError = await asActor(db, anon, () => expectError(db.query("select * from public.application_overview")));
    expect(anonError.message).toMatch(/permission denied/);
    const rows = await asActor(db, user(rrhh), () => db.query("select id from public.application_overview"));
    expect(rows.rows.length).toBeGreaterThan(0);
  });
});

describe("consume_public_rate_limit", () => {
  const subject = () => createHash("sha256").update(randomUUID()).digest("hex");
  const consume = (s: string, code: string) =>
    asService(async () => (await db.query<{ ok: boolean }>("select public.consume_public_rate_limit($1, $2) as ok", [s, code])).rows[0]!.ok);

  it("20 por hora por sujeto: el vigésimo primero se rechaza y otro sujeto no se ve afectado", async () => {
    const s = subject();
    for (let i = 0; i < 20; i++) expect(await consume(s, "limitesuj1")).toBe(true);
    expect(await consume(s, "limitesuj1")).toBe(false);
    expect(await consume(s, "limitesuj1")).toBe(false);
    expect(await consume(subject(), "limitesuj1")).toBe(true);
  });

  it("la ventana del sujeto se reinicia después de una hora", async () => {
    const s = subject();
    for (let i = 0; i < 21; i++) await consume(s, "limitesuj2");
    expect(await consume(s, "limitesuj2")).toBe(false);
    await db.query("update private.rate_limits set window_start = now() - interval '61 minutes' where key = $1", [`public_apply:subject:${s}`]);
    expect(await consume(s, "limitesuj2")).toBe(true);
  });

  it("300 por hora por vacante, aunque los sujetos sean distintos", async () => {
    const code = "limitevac1";
    await db.query(
      "insert into private.rate_limits (key, window_start, request_count) values ($1, now(), 299) on conflict (key) do update set request_count = 299, window_start = now()",
      [`public_apply:vacancy:${code}`],
    );
    expect(await consume(subject(), code)).toBe(true);
    expect(await consume(subject(), code)).toBe(false);
    expect(await consume(subject(), "limitevac2")).toBe(true);
    // Un sujeto rechazado por la vacante no deja sin cupo a las demás.
    await db.query("update private.rate_limits set window_start = now() - interval '2 hours' where key = $1", [`public_apply:vacancy:${code}`]);
    expect(await consume(subject(), code)).toBe(true);
  });

  it("1000 por día en total", async () => {
    await db.query(
      "insert into private.rate_limits (key, window_start, request_count) values ('public_apply:day', now(), 999) on conflict (key) do update set request_count = 999, window_start = now()",
    );
    expect(await consume(subject(), "limitedia1")).toBe(true);
    expect(await consume(subject(), "limitedia2")).toBe(false);
    await db.query("update private.rate_limits set window_start = now() - interval '25 hours' where key = 'public_apply:day'");
    expect(await consume(subject(), "limitedia3")).toBe(true);
  });

  it("un sujeto excedido no consume los cupos de la vacante ni el total", async () => {
    const s = subject();
    for (let i = 0; i < 20; i++) await consume(s, "limitesuj3");
    const before = await db.query<{ key: string; request_count: number }>(
      "select key, request_count from private.rate_limits where key in ('public_apply:vacancy:limitesuj3', 'public_apply:day') order by key",
    );
    expect(await consume(s, "limitesuj3")).toBe(false);
    const after = await db.query("select key, request_count from private.rate_limits where key in ('public_apply:vacancy:limitesuj3', 'public_apply:day') order by key");
    expect(after.rows).toEqual(before.rows);
  });

  it("purga en cada llamada, con tope de 200 filas, las claves de sujeto y vacante vencidas", async () => {
    await db.query(
      "insert into private.rate_limits (key, window_start, request_count) select 'public_apply:subject:old' || g, now() - interval '3 hours', 1 from generate_series(1, 250) g",
    );
    await db.query(
      "insert into private.rate_limits (key, window_start, request_count) values ('public_apply:vacancy:oldvacancy', now() - interval '3 hours', 1), ('public_apply:day', now() - interval '3 hours', 1), ('otra:clave', now() - interval '3 hours', 1) on conflict (key) do update set window_start = excluded.window_start, request_count = 1",
    );
    const left = () =>
      count("select 1 from private.rate_limits where key like 'public_apply:subject:old%' or key = 'public_apply:vacancy:oldvacancy'");
    expect(await left()).toBe(251);
    await consume(subject(), "purgaprueb");
    expect(await left()).toBeLessThanOrEqual(51);
    expect(await left()).toBeGreaterThan(0);
    await consume(subject(), "purgaprueb");
    await consume(subject(), "purgaprueb");
    expect(await left()).toBe(0);
    // Ni el total diario ni claves ajenas se purgan aquí.
    expect(await count("select 1 from private.rate_limits where key in ('public_apply:day', 'otra:clave')")).toBe(2);
  });

  it("solo acepta un HMAC hexadecimal: una IP en claro u otro formato se rechaza", async () => {
    for (const bad of ["203.0.113.9", "::1", "", "A".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      const error = await expectError(consume(bad, "limitesuj4"));
      expect(error.message, bad).toMatch(/Sujeto no válido/);
    }
    const error = await expectError(consume(subject(), "Código no válido"));
    expect(error.message).toMatch(/Código de vacante no válido/);
    const keys = await db.query<{ key: string }>("select key from private.rate_limits where key like 'public_apply:%'");
    expect(keys.rows.map((row) => row.key).join(" ")).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("consume_form_challenge", () => {
  const consume = (hash: string) =>
    asService(async () => (await db.query<{ ok: boolean }>("select public.consume_form_challenge($1) as ok", [hash])).rows[0]!.ok);

  it("un desafío sirve una sola vez", async () => {
    const hash = sha();
    expect(await consume(hash)).toBe(true);
    expect(await consume(hash)).toBe(false);
    expect(await consume(sha())).toBe(true);
  });

  it("borra los registros de más de un día", async () => {
    const old = sha();
    await consume(old);
    await db.query("update public.public_form_challenges set used_at = now() - interval '25 hours' where challenge_hash = $1", [old]);
    const recent = sha();
    await consume(recent);
    await consume(sha());
    expect(await count("select 1 from public.public_form_challenges where challenge_hash = $1", [old])).toBe(0);
    expect(await count("select 1 from public.public_form_challenges where challenge_hash = $1", [recent])).toBe(1);
  });

  it("solo acepta el SHA-256 en hexadecimal", async () => {
    for (const bad of ["", "abc", "Z".repeat(64), "A".repeat(64)]) {
      const error = await expectError(consume(bad));
      expect(error.message, bad).toMatch(/Desafío no válido|check/);
    }
  });
});
