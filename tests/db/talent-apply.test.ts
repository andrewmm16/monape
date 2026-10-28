import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addRequirement, anon, asActor, createCandidate, createTestDatabase, createUser, expectError, user } from "./harness";

let db: PGlite;
let rrhh: string;
let inactive: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  inactive = await createUser(db, "rrhh", "Persona Desactivada");
  await db.query("update public.profiles set is_active = false where id = $1", [inactive]);
});

afterAll(async () => {
  await db?.close();
});

/** Ejecuta `fn` con el rol de servicio (la clave secreta de Supabase). */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
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

/** Vacante publicada con código público (se crea como superusuario: sin validación de usuario). */
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
  externalId: string;
  candidateId: string;
  resumeId: string;
  fullName: string;
  email: string;
  phone: string | null;
  sha256: string;
}>;

/** Llama a register_integration_application como service_role. */
function register(code: string, submission: Submission = {}) {
  const candidateId = submission.candidateId ?? randomUUID();
  const resumeId = submission.resumeId ?? randomUUID();
  return asService(() =>
    db.query<{ application_id: string | null; already_registered: boolean }>(
      `select * from public.register_integration_application(
         'talent_apply', $1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, 'cv.pdf', 'application/pdf', 1000, $9,
         'completada', 'pdf_text', 'extractor-v1', 'Texto ficticio del CV con experiencia en SQL.', '{}'::jsonb, '{}', null)`,
      [
        submission.externalId ?? `ta-${randomUUID()}`,
        code,
        candidateId,
        resumeId,
        `candidates/${candidateId}/${resumeId}.pdf`,
        submission.fullName ?? "Lucía Ramos Ficticia",
        submission.email ?? `${randomUUID().slice(0, 8)}@correo.test`,
        submission.phone === undefined ? null : submission.phone,
        submission.sha256 ?? sha(),
      ],
    ),
  );
}

const count = async (sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`, params)).rows[0]!.n;

describe("catálogo", () => {
  it("«Trabajos Diarios» es un portal manual de bolsa de empleo en la posición 135, sin duplicarse", async () => {
    const { rows } = await db.query<{ kind: string; candidate_source: string; position: number; is_active: boolean }>(
      "select kind, candidate_source, position, is_active from public.job_portals where name = 'Trabajos Diarios'",
    );
    expect(rows).toEqual([{ kind: "manual", candidate_source: "bolsa_empleo", position: 135, is_active: true }]);
    await db.query(
      `insert into public.job_portals (name, kind, candidate_source, position)
       values ('Trabajos Diarios', 'manual', 'bolsa_empleo', 135) on conflict (name) do nothing`,
    );
    expect(await count("select 1 from public.job_portals where name = 'Trabajos Diarios'")).toBe(1);
  });
});

describe("privilegios: solo service_role", () => {
  const integration = [
    "public.register_integration_application",
    "public.reject_integration_submission",
    "public.consume_integration_rate_limit",
    "public.record_system_evaluation",
  ];

  it("anon y authenticated no ejecutan las funciones nuevas; service_role sí", async () => {
    const { rows } = await db.query<{ proname: string; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [integration.map((name) => name.replace("public.", ""))],
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row, row.proname).toMatchObject({ anon: false, authenticated: false, service: true });
  });

  it("al llamarlas, anon y un usuario autenticado reciben «permission denied»", async () => {
    const calls = [
      "select public.consume_integration_rate_limit('talent_apply', 'abcdefghij')",
      "select public.reject_integration_submission('talent_apply', 'x', 'abcdefghij', 'cv_invalido')",
    ];
    for (const sql of calls) {
      for (const actor of [anon, user(rrhh)]) {
        const error = await asActor(db, actor, () => expectError(db.query(sql)));
        expect(error.message).toMatch(/permission denied/);
      }
    }
    const { code } = await createPublished();
    for (const actor of [anon, user(rrhh)]) {
      const error = await asActor(db, actor, () =>
        expectError(
          db.query(
            `select * from public.register_integration_application('talent_apply', 'x', $1, gen_random_uuid(), gen_random_uuid(),
               'candidates/x/y.pdf', 'Nombre', 'a@b.cd', null, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
               'completada', 'pdf_text', 'v', null, '{}'::jsonb, '{}', null)`,
            [code],
          ),
        ),
      );
      expect(error.message).toMatch(/permission denied/);
    }
  });

  it("los núcleos privados no los ejecuta nadie más que el propietario", async () => {
    const { rows } = await db.query<{ proname: string; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' and p.proname in ('record_evaluation_core', 'register_resume_core')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row, row.proname).toMatchObject({ anon: false, authenticated: false, service: false });
  });

  it("record_evaluation y register_resume siguen para usuarios (no para anon) y exigen personal", async () => {
    const { rows } = await db.query<{ proname: string; anon: boolean; authenticated: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('record_evaluation', 'register_resume')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row, row.proname).toMatchObject({ anon: false, authenticated: true });

    const candidateId = await createCandidate(db);
    const denied = await asActor(db, user(inactive), () =>
      expectError(
        db.query(
          `select public.register_resume(gen_random_uuid(), $1::uuid, 'candidates/' || $1::text || '/a.pdf', 'cv.pdf',
             'application/pdf', 1000, repeat('a', 64), 'completada', 'pdf_text', 'v', 'texto', '{}'::jsonb, '{}', null)`,
          [candidateId],
        ),
      ),
    );
    expect(denied.message).toMatch(/No autorizado/);
  });
});

describe("tabla integration_submissions", () => {
  it("no tiene columnas de IP, user agent ni carga cruda", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'integration_submissions' order by ordinal_position`,
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns).toEqual([
      "id",
      "provider",
      "external_id",
      "vacancy_id",
      "candidate_id",
      "application_id",
      "status",
      "reason",
      "duplicate_reasons",
      "received_at",
    ]);
    expect(columns.join(",")).not.toMatch(/ip|agent|payload|raw|body/);
  });

  it("el personal solo lee; nadie escribe desde la API; anon no accede", async () => {
    const { code } = await createPublished();
    await register(code);

    const read = await asActor(db, user(rrhh), () => db.query("select id from public.integration_submissions"));
    expect(read.rows.length).toBeGreaterThan(0);
    const none = await asActor(db, user(inactive), () => db.query("select id from public.integration_submissions"));
    expect(none.rows).toHaveLength(0);

    for (const sql of [
      "insert into public.integration_submissions (provider, external_id, status) values ('talent_apply', 'z', 'rechazada')",
      "update public.integration_submissions set status = 'rechazada'",
      "delete from public.integration_submissions",
    ]) {
      const error = await asActor(db, user(rrhh), () => expectError(db.query(sql)));
      expect(error.message).toMatch(/permission denied/);
    }
    const anonError = await asActor(db, anon, () => expectError(db.query("select id from public.integration_submissions")));
    expect(anonError.message).toMatch(/permission denied/);
  });

  it("restricciones: proveedor, identificador y motivos de duplicado", async () => {
    const insert = (provider: string, externalId: string, reasons = "{}") =>
      db.query(
        "insert into public.integration_submissions (provider, external_id, status, duplicate_reasons) values ($1, $2, 'rechazada', $3::text[])",
        [provider, externalId, reasons],
      );
    expect((await expectError(insert("otro", "a"))).message).toMatch(/check/);
    expect((await expectError(insert("talent_apply", ""))).message).toMatch(/check/);
    expect((await expectError(insert("talent_apply", "x".repeat(201)))).message).toMatch(/check/);
    expect((await expectError(insert("talent_apply", "ok-1", "{nombre}"))).message).toMatch(/check/);
    await insert("talent_apply", "ok-2", "{correo,cv}");
    expect((await expectError(insert("talent_apply", "ok-2"))).message).toMatch(/duplicate key|unique/);
  });
});

describe("register_integration_application", () => {
  it("crea candidato nuevo, CV, postulación `nuevo` por Talent.com/integración, evento y auditoría con actor nulo", async () => {
    const { id: vacancyId, code } = await createPublished();
    const fullName = "Nombre Secreto Ficticio";
    const email = "correo.secreto@correo.test";
    const externalId = `ta-${randomUUID()}`;

    const { rows } = await register(code, { externalId, fullName, email, phone: "+51 944 555 666" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.already_registered).toBe(false);
    const applicationId = rows[0]!.application_id!;

    const application = await db.query<{
      status: string;
      intake_method: string;
      portal: string;
      source: string;
      source_detail: string;
      origins: Record<string, string>;
      created_by: string | null;
      vacancy_id: string;
      resume_id: string | null;
    }>(
      `select a.status, a.intake_method, p.name as portal, c.source, c.source_detail, c.field_origins as origins,
              c.created_by, a.vacancy_id, a.resume_id
         from public.applications a
         join public.job_portals p on p.id = a.portal_id
         join public.candidates c on c.id = a.candidate_id
        where a.id = $1`,
      [applicationId],
    );
    expect(application.rows[0]).toMatchObject({
      status: "nuevo",
      intake_method: "integracion",
      portal: "Talent.com",
      source: "bolsa_empleo",
      source_detail: "Talent.com",
      origins: { full_name: "declarado", email: "declarado", phone: "declarado" },
      created_by: null,
      vacancy_id: vacancyId,
    });
    expect(application.rows[0]!.resume_id).not.toBeNull();
    expect(await count("select 1 from public.resume_extractions e join public.resumes r on r.id = e.resume_id where r.id = $1", [application.rows[0]!.resume_id])).toBe(1);

    const events = await db.query<{ event_type: string; actor_id: string | null; to_status: string }>(
      "select event_type, actor_id, to_status from public.application_events where application_id = $1",
      [applicationId],
    );
    expect(events.rows).toEqual([{ event_type: "postulacion_creada", actor_id: null, to_status: "nuevo" }]);

    const audit = await db.query<{ actor_id: string | null; metadata: Record<string, unknown> }>(
      "select actor_id, metadata from public.audit_logs where action = 'integracion_postulacion' and entity_id = $1",
      [applicationId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.actor_id).toBeNull();
    expect(audit.rows[0]!.metadata).toMatchObject({ provider: "talent_apply", intake_method: "integracion", portal: "Talent.com" });
    const everyAuditRow = JSON.stringify((await db.query("select * from public.audit_logs")).rows);
    expect(everyAuditRow).not.toContain(fullName);
    expect(everyAuditRow).not.toContain(email);
    expect(everyAuditRow).not.toContain(externalId);

    const submission = await db.query<{ status: string; reason: string | null; application_id: string; duplicate_reasons: string[] }>(
      "select status, reason, application_id, duplicate_reasons from public.integration_submissions where external_id = $1",
      [externalId],
    );
    expect(submission.rows).toEqual([{ status: "registrada", reason: null, application_id: applicationId, duplicate_reasons: [] }]);
  });

  it("es idempotente por id: devuelve la misma postulación y no crea nada más", async () => {
    const { code } = await createPublished();
    const externalId = `ta-${randomUUID()}`;
    const first = await register(code, { externalId });
    const candidates = await count("select 1 from public.candidates");
    const applications = await count("select 1 from public.applications");

    const second = await register(code, { externalId });
    expect(second.rows[0]).toEqual({ application_id: first.rows[0]!.application_id, already_registered: true });
    expect(await count("select 1 from public.candidates")).toBe(candidates);
    expect(await count("select 1 from public.applications")).toBe(applications);
    expect(await count("select 1 from public.integration_submissions where external_id = $1", [externalId])).toBe(1);
  });

  it("la repetición se reconoce aunque la vacante se haya cerrado después", async () => {
    const { id, code } = await createPublished();
    const externalId = `ta-${randomUUID()}`;
    const first = await register(code, { externalId });
    await db.query("update public.vacancies set status = 'cerrada' where id = $1", [id]);
    const again = await register(code, { externalId });
    expect(again.rows[0]).toEqual({ application_id: first.rows[0]!.application_id, already_registered: true });
  });

  it("rechaza vacante cerrada (RH409), vencida (RH409), confidencial, en borrador, sin datos públicos o inexistente (RH404)", async () => {
    const closed = await createPublished({ status: "cerrada" });
    const expired = await createPublished({ closingDate: await limaToday(-1) });
    const confidential = await createPublished({ confidential: true });
    const incomplete = await createPublished({ complete: false });
    const draft = await createPublished();
    await db.query("update public.vacancies set status = 'archivada' where id = $1", [draft.id]);

    const before = {
      candidates: await count("select 1 from public.candidates"),
      submissions: await count("select 1 from public.integration_submissions"),
    };
    const cases: [string, string][] = [
      [closed.code, "RH409"],
      [expired.code, "RH409"],
      [confidential.code, "RH404"],
      [incomplete.code, "RH404"],
      [draft.code, "RH404"],
      ["zzzzzzzzzz", "RH404"],
    ];
    for (const [code, errcode] of cases) {
      const error = (await expectError(register(code))) as Error & { code?: string };
      expect(error.code ?? error.message, code).toBe(errcode);
    }
    expect(await count("select 1 from public.candidates")).toBe(before.candidates);
    expect(await count("select 1 from public.integration_submissions")).toBe(before.submissions);

    // Hoy es el último día para postular: todavía se acepta.
    const today = await createPublished({ closingDate: await limaToday(0) });
    expect((await register(today.code)).rows[0]!.already_registered).toBe(false);
  });

  it("calcula duplicate_reasons (correo en minúsculas, teléfono por dígitos, CV por SHA-256) sin tocar fichas existentes", async () => {
    const { code } = await createPublished();
    const sharedSha = sha("cv-compartido");
    // Número propio de esta prueba: la base es compartida con otras pruebas del archivo.
    const digits = String(800000000 + Math.floor(Math.random() * 99_999_999));
    const spaced = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    const first = await register(code, {
      fullName: "Primera Persona",
      email: "Dup@Correo.test",
      phone: `+51 ${spaced}`,
      sha256: sharedSha,
    });
    const firstApp = first.rows[0]!.application_id!;
    expect((await db.query("select duplicate_reasons from public.integration_submissions where application_id = $1", [firstApp])).rows[0]).toEqual({
      duplicate_reasons: [],
    });

    const before = await db.query<{ id: string; full_name: string; email: string; phone: string; updated_at: string }>(
      "select id, full_name, email, phone, updated_at from public.candidates order by id",
    );
    const reasonsOf = async (submission: Submission) => {
      const { rows } = await register(code, submission);
      const result = await db.query<{ duplicate_reasons: string[] }>(
        "select duplicate_reasons from public.integration_submissions where application_id = $1",
        [rows[0]!.application_id],
      );
      return result.rows[0]!.duplicate_reasons;
    };

    expect(await reasonsOf({ email: "dup@correo.test", phone: spaced.replaceAll(" ", "-"), sha256: sharedSha })).toEqual(["correo", "telefono", "cv"]);
    expect(await reasonsOf({ email: "DUP@CORREO.TEST", phone: null })).toEqual(["correo"]);
    expect(await reasonsOf({ phone: `(51) ${spaced}` })).toEqual(["telefono"]);
    expect(await reasonsOf({ sha256: sharedSha })).toEqual(["cv"]);
    expect(await reasonsOf({ phone: "123" })).toEqual([]);

    // Los candidatos anteriores no cambian y cada postulación creó uno nuevo.
    const after = await db.query("select id, full_name, email, phone, updated_at from public.candidates where id = any($1::uuid[]) order by id", [
      before.rows.map((row) => row.id),
    ]);
    expect(after.rows).toEqual(before.rows);
    expect(await count("select 1 from public.candidates")).toBe(before.rows.length + 5);

    // Una ficha creada a mano con el mismo correo también cuenta, y tampoco se modifica.
    const manualId = await createCandidate(db, "Ficha Manual");
    const manual = await db.query<{ email: string }>("select email from public.candidates where id = $1", [manualId]);
    expect(await reasonsOf({ email: manual.rows[0]!.email.toUpperCase() })).toEqual(["correo"]);
    expect((await db.query("select full_name from public.candidates where id = $1", [manualId])).rows[0]).toEqual({ full_name: "Ficha Manual" });
  });

  it("valida proveedor e identificador y deja todo intacto si algo falla a mitad", async () => {
    const { code } = await createPublished();
    const bad = (await expectError(
      asService(() =>
        db.query(
          `select * from public.register_integration_application('otro', 'x', $1, gen_random_uuid(), gen_random_uuid(),
             'candidates/x/y.pdf', 'Nombre', 'a@b.cd', null, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
             'completada', 'pdf_text', 'v', null, '{}'::jsonb, '{}', null)`,
          [code],
        ),
      ),
    )) as Error & { code?: string };
    expect(bad.code).toBe("RH422");

    // Ruta que no corresponde al candidato: falla el CV y se revierte el candidato.
    const externalId = `ta-${randomUUID()}`;
    const candidates = await count("select 1 from public.candidates");
    await expectError(
      asService(() =>
        db.query(
          `select * from public.register_integration_application('talent_apply', $2, $1, gen_random_uuid(), gen_random_uuid(),
             'candidates/otro/y.pdf', 'Nombre Ficticio', 'a@b.cd', null, 'cv.pdf', 'application/pdf', 10, repeat('a', 64),
             'completada', 'pdf_text', 'v', null, '{}'::jsonb, '{}', null)`,
          [code, externalId],
        ),
      ),
    );
    expect(await count("select 1 from public.candidates")).toBe(candidates);
    expect(await count("select 1 from public.integration_submissions where external_id = $1", [externalId])).toBe(0);
  });
});

describe("postulaciones rechazadas", () => {
  it("quedan con un motivo corto, no pisan a una registrada y permiten reintentar con el mismo id", async () => {
    const { id, code } = await createPublished();
    const externalId = `ta-${randomUUID()}`;
    const reject = (reason: string, external = externalId) =>
      asService(() => db.query("select public.reject_integration_submission('talent_apply', $1, $2, $3)", [external, code, reason]));

    await reject("cv_invalido");
    await reject("cv_vacio");
    const rejected = await db.query<{ status: string; reason: string; vacancy_id: string; application_id: string | null }>(
      "select status, reason, vacancy_id, application_id from public.integration_submissions where external_id = $1",
      [externalId],
    );
    expect(rejected.rows).toEqual([{ status: "rechazada", reason: "cv_invalido", vacancy_id: id, application_id: null }]);

    // El motivo es un código: un texto libre (por ejemplo con datos personales) no se acepta.
    const invalidReason = (await expectError(reject("correo ana@correo.test"))) as Error & { code?: string };
    expect(invalidReason.code).toBe("RH422");

    // Reintento con un CV válido: la fila pasa a registrada.
    const retried = await register(code, { externalId });
    expect(retried.rows[0]!.already_registered).toBe(false);
    const registered = await db.query<{ status: string; reason: string | null }>(
      "select status, reason from public.integration_submissions where external_id = $1",
      [externalId],
    );
    expect(registered.rows).toEqual([{ status: "registrada", reason: null }]);

    // Rechazar después no deshace el registro.
    await reject("cv_invalido");
    expect((await db.query("select status from public.integration_submissions where external_id = $1", [externalId])).rows).toEqual([
      { status: "registrada" },
    ]);
  });
});

describe("evaluación del sistema (actor nulo) y vista", () => {
  async function approvedApplication() {
    const vacancy = await createPublished();
    const requirementId = await addRequirement(db, vacancy.id, { description: "Consultas SQL", weight: 2 });
    const criteriaVersion = await db
      .query<{ criteria_version: number }>(
        "update public.vacancies set criteria_version = criteria_version + 1, criteria_approved_at = now() where id = $1 returning criteria_version",
        [vacancy.id],
      )
      .then((result) => result.rows[0]!.criteria_version);
    const { rows } = await register(vacancy.code, { email: "evaluado@correo.test", phone: "955 000 111" });
    const applicationId = rows[0]!.application_id!;
    const resume = await db.query<{ resume_id: string }>("select resume_id from public.applications where id = $1", [applicationId]);
    return { applicationId, resumeId: resume.rows[0]!.resume_id, requirementId, criteriaVersion };
  }

  const evaluationSql = (fn: string) =>
    `select public.${fn}($1::uuid, $2::uuid, $3, 'reglas', 'reglas-v1', 'v1', null, 100, 100, 100, 'alta', 'Resumen ficticio',
       array['Limitación de prueba'], null, $4::jsonb) as id`;
  const params = (a: Awaited<ReturnType<typeof approvedApplication>>) => [
    a.applicationId,
    a.resumeId,
    a.criteriaVersion,
    JSON.stringify([{ requirement_id: a.requirementId, assessment: "acreditado" }]),
  ];

  it("record_system_evaluation guarda evaluación y evento con actor nulo; la vista trae los duplicados", async () => {
    const a = await approvedApplication();
    const { rows } = await asService(() => db.query<{ id: string }>(evaluationSql("record_system_evaluation"), params(a)));
    const evaluation = await db.query<{ created_by: string | null; level: string }>(
      "select created_by, level from public.candidate_evaluations where id = $1",
      [rows[0]!.id],
    );
    expect(evaluation.rows).toEqual([{ created_by: null, level: "alta" }]);
    const event = await db.query<{ actor_id: string | null }>(
      "select actor_id from public.application_events where application_id = $1 and event_type = 'evaluacion_generada'",
      [a.applicationId],
    );
    expect(event.rows).toEqual([{ actor_id: null }]);
    expect(
      (await db.query<{ latest_evaluation_id: string }>("select latest_evaluation_id from public.applications where id = $1", [a.applicationId])).rows[0]!
        .latest_evaluation_id,
    ).toBe(rows[0]!.id);

    // Una segunda postulación con el mismo correo y teléfono aparece marcada en la vista.
    const { code } = await createPublished();
    const dup = await register(code, { email: "EVALUADO@correo.test", phone: "955000111" });
    const overview = await asActor(db, user(rrhh), () =>
      db.query<{ possible_duplicate_reasons: string[]; portal_name: string; intake_method: string; evaluation_id: string | null }>(
        "select possible_duplicate_reasons, portal_name, intake_method, evaluation_id from public.application_overview where id = any($1::uuid[]) order by applied_at",
        [[a.applicationId, dup.rows[0]!.application_id]],
      ),
    );
    expect(overview.rows).toEqual([
      { possible_duplicate_reasons: [], portal_name: "Talent.com", intake_method: "integracion", evaluation_id: rows[0]!.id },
      { possible_duplicate_reasons: ["correo", "telefono"], portal_name: "Talent.com", intake_method: "integracion", evaluation_id: null },
    ]);
  });

  it("conserva las validaciones del núcleo: criterios aprobados, versión y porcentajes", async () => {
    const a = await approvedApplication();
    const wrongVersion = (await expectError(
      asService(() => db.query(evaluationSql("record_system_evaluation"), [a.applicationId, a.resumeId, a.criteriaVersion + 1, params(a)[3]])),
    )) as Error & { code?: string };
    expect(wrongVersion.code).toBe("RH409");
    const wrongScore = (await expectError(
      asService(() =>
        db.query(
          `select public.record_system_evaluation($1::uuid, $2::uuid, $3, 'reglas', 'reglas-v1', 'v1', null, 50, 100, 100, 'alta', 's',
             '{}', null, $4::jsonb)`,
          params(a),
        ),
      ),
    )) as Error & { code?: string };
    expect(wrongScore.code).toBe("RH422");
  });

  it("record_evaluation sigue exigiendo personal y registra al usuario como autor", async () => {
    const a = await approvedApplication();
    const anonError = await asActor(db, anon, () => expectError(db.query(evaluationSql("record_evaluation"), params(a))));
    expect(anonError.message).toMatch(/permission denied/);
    const inactiveError = await asActor(db, user(inactive), () => expectError(db.query(evaluationSql("record_evaluation"), params(a))));
    expect(inactiveError.message).toMatch(/No autorizado/);
    const systemAsUser = await asActor(db, user(rrhh), () => expectError(db.query(evaluationSql("record_system_evaluation"), params(a))));
    expect(systemAsUser.message).toMatch(/permission denied/);

    const { rows } = await asActor(db, user(rrhh), () => db.query<{ id: string }>(evaluationSql("record_evaluation"), params(a)));
    expect((await db.query("select created_by from public.candidate_evaluations where id = $1", [rows[0]!.id])).rows).toEqual([{ created_by: rrhh }]);
    expect(
      (await db.query("select actor_id from public.application_events where application_id = $1 and event_type = 'evaluacion_generada'", [a.applicationId])).rows,
    ).toEqual([{ actor_id: rrhh }]);
  });

  it("la vista conserva sus propiedades (security_invoker) y anon sigue sin acceso", async () => {
    const { rows } = await db.query<{ reloptions: string[] | null }>(
      "select c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'application_overview'",
    );
    expect(rows[0]!.reloptions).toContain("security_invoker=true");
    const error = await asActor(db, anon, () => expectError(db.query("select * from public.application_overview")));
    expect(error.message).toMatch(/permission denied/);
    const inactiveRows = await asActor(db, user(inactive), () => db.query("select id from public.application_overview"));
    expect(inactiveRows.rows).toHaveLength(0);
  });
});

describe("límite de solicitudes de integración", () => {
  const consumeMany = (code: string, times: number) =>
    asService(() =>
      db.query<{ allowed: number; denied: number }>(
        `select count(*) filter (where ok)::int as allowed, count(*) filter (where not ok)::int as denied
           from (select public.consume_integration_rate_limit('talent_apply', $1) as ok from generate_series(1, $2)) t`,
        [code, times],
      ),
    );

  it("200 por hora por vacante y 1000 por día en total", async () => {
    expect((await consumeMany("aaaaaaaaaa", 201)).rows[0]).toEqual({ allowed: 200, denied: 1 });
    // Otra vacante tiene su propio límite por hora.
    expect((await consumeMany("bbbbbbbbbb", 200)).rows[0]).toEqual({ allowed: 200, denied: 0 });
    expect((await consumeMany("cccccccccc", 200)).rows[0]).toEqual({ allowed: 200, denied: 0 });
    expect((await consumeMany("dddddddddd", 200)).rows[0]).toEqual({ allowed: 200, denied: 0 });
    expect((await consumeMany("eeeeeeeeee", 200)).rows[0]).toEqual({ allowed: 200, denied: 0 });
    // Ya van 1000 en el día: cualquier vacante queda limitada.
    expect((await consumeMany("ffffffffff", 2)).rows[0]).toEqual({ allowed: 0, denied: 2 });
  });

  it("las ventanas se reinician con el tiempo y no se guarda IP", async () => {
    await db.query("update private.rate_limits set window_start = now() - interval '25 hours' where key like 'integration:%'");
    expect((await consumeMany("aaaaaaaaaa", 1)).rows[0]).toEqual({ allowed: 1, denied: 0 });
    const keys = await db.query<{ key: string }>("select key from private.rate_limits where key like 'integration:%' order by key");
    for (const row of keys.rows) expect(row.key).toMatch(/^integration:talent_apply:(day|vacancy:[a-z0-9]{10})$/);
  });

  it("rechaza proveedor o código de vacante con formato inválido", async () => {
    const badCode = (await expectError(consumeMany("no-valido", 1))) as Error & { code?: string };
    expect(badCode.code).toBe("RH422");
    const badProvider = (await expectError(
      asService(() => db.query("select public.consume_integration_rate_limit('otro', 'aaaaaaaaaa')")),
    )) as Error & { code?: string };
    expect(badProvider.code).toBe("RH422");
  });
});
