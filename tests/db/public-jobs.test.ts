import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addRequirement, anon, asActor, createTestDatabase, createUser, expectError, user } from "./harness";

let db: PGlite;
let rrhh: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
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

type Overrides = Partial<{
  title: string;
  description: string;
  city: string | null;
  region: string | null;
  employmentType: string | null;
  modality: string | null;
  confidential: boolean;
  closingDate: string | null;
}>;

const LONG_DESCRIPTION = "Descripción ficticia de la vacante con más de cincuenta caracteres en total.";

/** Crea una vacante como RRHH, en borrador. */
async function createDraft(overrides: Overrides = {}): Promise<string> {
  const values = {
    title: "Analista de datos",
    description: LONG_DESCRIPTION,
    city: "Lima",
    region: "Lima",
    employmentType: "tiempo_completo",
    modality: "hibrido",
    confidential: false,
    closingDate: null,
    ...overrides,
  };
  return asActor(db, user(rrhh), async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.vacancies
         (title, department, description, city, region, employment_type, modality, is_confidential, closing_date)
       values ($1, 'Operaciones', $2, $3, $4, $5::public.employment_type, $6::public.work_modality, $7, $8::date)
       returning id`,
      [
        values.title,
        values.description,
        values.city,
        values.region,
        values.employmentType,
        values.modality,
        values.confidential,
        values.closingDate,
      ],
    );
    return rows[0]!.id;
  });
}

function setStatus(id: string, status: string) {
  return asActor(db, user(rrhh), () =>
    db.query("update public.vacancies set status = $2::public.vacancy_status where id = $1", [id, status]),
  );
}

async function createPublished(overrides: Overrides = {}): Promise<{ id: string; code: string }> {
  const id = await createDraft(overrides);
  await setStatus(id, "publicada");
  const { rows } = await db.query<{ public_code: string }>("select public_code from public.vacancies where id = $1", [id]);
  return { id, code: rows[0]!.public_code };
}

async function listedCodes(): Promise<string[]> {
  const { rows } = await asService(() => db.query<{ code: string }>("select code from public.public_vacancies()"));
  return rows.map((row) => row.code);
}

async function limaToday(offsetDays: number): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    "select (((now() at time zone 'America/Lima')::date) + $1::int)::text as d",
    [offsetDays],
  );
  return rows[0]!.d;
}

describe("lectura pública: solo service_role", () => {
  const calls = [
    "select * from public.public_vacancies()",
    "select * from public.public_vacancy('abcdefghij')",
    "select * from public.public_vacancy_requirements('abcdefghij')",
  ];

  it("anon y authenticated no pueden ejecutar las funciones; service_role sí", async () => {
    for (const sql of calls) {
      for (const actor of [anon, user(rrhh)]) {
        const error = await asActor(db, actor, () => expectError(db.query(sql)));
        expect(error.message).toMatch(/permission denied/);
      }
      await expect(asService(() => db.query(sql))).resolves.toBeDefined();
    }
    const { rows } = await db.query<{ proname: string; anon: boolean; authenticated: boolean; service: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'public\\_vacanc%'`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toMatchObject({ anon: false, authenticated: false, service: true });
  });

  it("anon sigue sin privilegios sobre vacantes (tabla ni columnas nuevas)", async () => {
    const { rows } = await db.query(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'vacancies' and grantee = 'anon'`,
    );
    expect(rows).toEqual([]);
  });

  it("la lista de columnas es cerrada y no incluye datos internos", async () => {
    await createPublished({ title: "Columnas visibles" });
    const { fields } = await asService(() => db.query("select * from public.public_vacancies()"));
    expect(fields.map((field) => field.name)).toEqual([
      "code",
      "title",
      "department",
      "description",
      "responsibilities",
      "city",
      "region",
      "modality",
      "employment_type",
      "contract_type",
      "salary_min",
      "salary_max",
      "salary_currency",
      "salary_period",
      "first_published_at",
      "closing_date",
      "updated_at",
    ]);
    const detail = await asService(() => db.query("select * from public.public_vacancy('abcdefghij')"));
    expect(detail.fields.map((field) => field.name)).toEqual([...fields.map((field) => field.name), "accepting_applications"]);
  });
});

describe("qué vacantes se exponen", () => {
  it("excluye confidenciales, borradores, archivadas, vencidas e incompletas; incluye abiertas y las que vencen hoy", async () => {
    const open = await createPublished({ title: "Abierta" });
    const today = await createPublished({ title: "Vence hoy", closingDate: await limaToday(0) });
    const remote = await createPublished({ title: "Remota", modality: "remoto", city: null, region: null });
    const confidential = await createPublished({ title: "Confidencial", confidential: true });
    const draft = await createDraft({ title: "Borrador" });
    const archived = await createDraft({ title: "Archivada" });
    await setStatus(archived, "archivada");
    const closed = await createPublished({ title: "Cerrada" });
    await setStatus(closed.id, "cerrada");
    const expired = await createPublished({ title: "Vencida" });
    await db.query("update public.vacancies set closing_date = $2::date where id = $1", [expired.id, await limaToday(-1)]);
    // Ya estaba publicada sin los datos exigidos (carga de servicio, sin validación).
    const { rows: legacyRows } = await db.query<{ public_code: string }>(
      `insert into public.vacancies (title, department, description, status)
       values ('Antigua incompleta', 'Operaciones', 'Corta', 'publicada') returning public_code`,
    );
    const legacy = legacyRows[0]!.public_code;

    const codes = await listedCodes();
    expect(codes).toEqual(expect.arrayContaining([open.code, today.code, remote.code]));
    for (const excluded of [confidential.code, closed.code, expired.code, legacy]) expect(codes).not.toContain(excluded);
    const { rows: draftRows } = await db.query<{ public_code: string | null }>(
      "select public_code from public.vacancies where id = $1",
      [draft],
    );
    expect(draftRows[0]!.public_code).toBeNull();

    const detail = (code: string) =>
      asService(() => db.query<{ title: string; accepting_applications: boolean }>("select * from public.public_vacancy($1)", [code]));
    expect((await detail(open.code)).rows[0]).toMatchObject({ title: "Abierta", accepting_applications: true });
    expect((await detail(closed.code)).rows[0]).toMatchObject({ title: "Cerrada", accepting_applications: false });
    expect((await detail(expired.code)).rows[0]).toMatchObject({ accepting_applications: false });
    for (const hidden of [confidential.code, legacy, "inexistente"]) expect((await detail(hidden)).rows).toEqual([]);
  });

  it("una vacante confidencial cerrada tampoco se expone", async () => {
    const confidential = await createPublished({ confidential: true });
    await setStatus(confidential.id, "cerrada");
    const { rows } = await asService(() => db.query("select * from public.public_vacancy($1)", [confidential.code]));
    expect(rows).toEqual([]);
  });

  it("los requisitos exponen solo descripción y prioridad, en orden", async () => {
    const { id, code } = await createPublished({ title: "Con requisitos" });
    await addRequirement(db, id, { description: "Consultas SQL avanzadas", weight: 9, priority: "obligatorio" });
    await addRequirement(db, id, { description: "Power BI", weight: 2, priority: "deseable" });
    await db.query(
      `update public.vacancy_requirements
          set keywords = array['término secreto'], min_years = 5, is_essential = true, position = 1
        where description = 'Power BI' and vacancy_id = $1`,
      [id],
    );
    await db.query("update public.vacancy_requirements set position = 0 where description = 'Consultas SQL avanzadas' and vacancy_id = $1", [id]);

    const result = await asService(() => db.query("select * from public.public_vacancy_requirements($1)", [code]));
    expect(result.fields.map((field) => field.name)).toEqual(["description", "priority"]);
    expect(result.rows).toEqual([
      { description: "Consultas SQL avanzadas", priority: "obligatorio" },
      { description: "Power BI", priority: "deseable" },
    ]);
    expect(JSON.stringify(result.rows)).not.toContain("secreto");

    const confidential = await createPublished({ confidential: true });
    await addRequirement(db, confidential.id, { description: "Requisito reservado", weight: 3 });
    const hidden = await asService(() => db.query("select * from public.public_vacancy_requirements($1)", [confidential.code]));
    expect(hidden.rows).toEqual([]);
  });
});

describe("publicar", () => {
  it("falla sin los datos exigidos y dice qué falta", async () => {
    const id = await createDraft({ description: "Corta", employmentType: null, city: null, region: null });
    const error = await expectError(setStatus(id, "publicada"));
    expect(error.message).toMatch(/descripción de al menos 50 caracteres/);
    expect(error.message).toMatch(/tipo de empleo/);
    expect(error.message).toMatch(/ciudad y la región/);
    const { rows } = await db.query<{ status: string }>("select status from public.vacancies where id = $1", [id]);
    expect(rows[0]!.status).toBe("borrador");

    const onlyCity = await createDraft({ region: null });
    expect((await expectError(setStatus(onlyCity, "publicada"))).message).toMatch(/^.*ciudad y la región/);
    expect((await expectError(setStatus(onlyCity, "publicada"))).message).not.toMatch(/tipo de empleo/);
  });

  it("una vacante remota no necesita ciudad ni región; una confidencial no necesita ningún dato", async () => {
    const remote = await createDraft({ modality: "remoto", city: null, region: null });
    await expect(setStatus(remote, "publicada")).resolves.toBeDefined();
    const confidential = await createDraft({
      description: "",
      employmentType: null,
      city: null,
      region: null,
      confidential: true,
    });
    await expect(setStatus(confidential, "publicada")).resolves.toBeDefined();
  });

  it("al reabrir una vacante cerrada se vuelven a exigir los datos", async () => {
    const { id } = await createPublished();
    await setStatus(id, "cerrada");
    await db.query("update public.vacancies set employment_type = null where id = $1", [id]);
    expect((await expectError(setStatus(id, "publicada"))).message).toMatch(/tipo de empleo/);
  });
});

describe("código público y primera publicación", () => {
  it("se fijan al publicar por primera vez con el formato [a-z0-9]{10}", async () => {
    const id = await createDraft();
    const before = await db.query<{ public_code: string | null; first_published_at: string | null }>(
      "select public_code, first_published_at from public.vacancies where id = $1",
      [id],
    );
    expect(before.rows[0]).toEqual({ public_code: null, first_published_at: null });
    await setStatus(id, "publicada");
    const after = await db.query<{ public_code: string; first_published_at: string }>(
      "select public_code, first_published_at from public.vacancies where id = $1",
      [id],
    );
    expect(after.rows[0]!.public_code).toMatch(/^[a-z0-9]{10}$/);
    expect(after.rows[0]!.first_published_at).toBeTruthy();
  });

  it("nadie puede escribirlos y no cambian al cerrar y republicar", async () => {
    const { id, code } = await createPublished();
    const first = await db.query<{ first_published_at: string }>("select first_published_at from public.vacancies where id = $1", [id]);

    for (const column of ["public_code = 'zzzzzzzzzz'", "first_published_at = now() + interval '1 day'"]) {
      const denied = await asActor(db, user(rrhh), () =>
        expectError(db.query(`update public.vacancies set ${column} where id = $1`, [id])),
      );
      expect(denied.message).toMatch(/permission denied/);
    }
    const denied = await asActor(db, user(rrhh), () =>
      expectError(db.query("insert into public.vacancies (title, department, public_code) values ('Directa', 'Área', 'zzzzzzzzzz')")),
    );
    expect(denied.message).toMatch(/permission denied/);

    // Tampoco con privilegios de servicio o de propietario: el disparador los conserva.
    await db.query("update public.vacancies set public_code = 'zzzzzzzzzz', first_published_at = now() + interval '1 day' where id = $1", [id]);
    await setStatus(id, "cerrada");
    await setStatus(id, "publicada");
    const { rows } = await db.query<{ public_code: string; first_published_at: string }>(
      "select public_code, first_published_at from public.vacancies where id = $1",
      [id],
    );
    expect(rows[0]!.public_code).toBe(code);
    expect(rows[0]!.first_published_at).toEqual(first.rows[0]!.first_published_at);

    const inserted = await db.query<{ public_code: string | null }>(
      "insert into public.vacancies (title, department, public_code) values ('Directa', 'Área', 'zzzzzzzzzz') returning public_code",
    );
    expect(inserted.rows[0]!.public_code).toBeNull();
  });

  it("las vacantes cargadas ya publicadas reciben código y fecha", async () => {
    const { rows } = await db.query<{ public_code: string; first_published_at: string }>(
      `insert into public.vacancies (title, department, status) values ('Cargada publicada', 'Área', 'publicada')
       returning public_code, first_published_at`,
    );
    expect(rows[0]!.public_code).toMatch(/^[a-z0-9]{10}$/);
    expect(rows[0]!.first_published_at).toBeTruthy();
  });
});

describe("sueldo", () => {
  async function update(sql: string) {
    const id = await createDraft();
    return asActor(db, user(rrhh), () => db.query(`update public.vacancies set ${sql} where id = $1`, [id]));
  }

  it("acepta rango y monto fijo, y exige moneda y periodo", async () => {
    await expect(update("salary_min = 3000, salary_max = 4500, salary_currency = 'PEN', salary_period = 'mes'")).resolves.toBeDefined();
    await expect(update("salary_min = 25, salary_currency = 'USD', salary_period = 'hora'")).resolves.toBeDefined();
    await expect(update("salary_min = 3000")).rejects.toThrow(/vacancies_salary_check/);
    await expect(update("salary_min = 3000, salary_currency = 'PEN'")).rejects.toThrow(/vacancies_salary_check/);
  });

  it("rechaza máximo menor que el mínimo, solo máximo y valores negativos o monedas no admitidas", async () => {
    await expect(update("salary_min = 5000, salary_max = 4000, salary_currency = 'PEN', salary_period = 'mes'")).rejects.toThrow(
      /vacancies_salary_check/,
    );
    await expect(update("salary_max = 4000, salary_currency = 'PEN', salary_period = 'mes'")).rejects.toThrow(/vacancies_salary_check/);
    await expect(update("salary_min = -1, salary_currency = 'PEN', salary_period = 'mes'")).rejects.toThrow(/salary_min_check/);
    await expect(update("salary_min = 10, salary_currency = 'EUR', salary_period = 'mes'")).rejects.toThrow(/salary_currency_check/);
  });
});

describe("vacantes publicadas antes de la migración", () => {
  /** Simula una fila previa: publicada sin código (el disparador se deshabilita solo para insertarla). */
  async function insertLegacy(sql: string, params: unknown[] = []): Promise<string> {
    await db.exec("alter table public.vacancies disable trigger vacancies_publication");
    try {
      const { rows } = await db.query<{ id: string }>(sql, params);
      return rows[0]!.id;
    } finally {
      await db.exec("alter table public.vacancies enable trigger vacancies_publication");
    }
  }

  it("el backfill les asigna código y fecha, no toca las cerradas y el código ya no cambia", async () => {
    const id = await insertLegacy(
      `insert into public.vacancies (title, department, description, city, region, employment_type, status)
       values ('Previa publicada', 'Operaciones', $1, 'Lima', 'Lima', 'tiempo_completo', 'publicada') returning id`,
      [LONG_DESCRIPTION],
    );
    const closedId = await insertLegacy(
      "insert into public.vacancies (title, department, status) values ('Previa cerrada', 'Operaciones', 'cerrada') returning id",
    );
    const read = (vacancyId: string) =>
      db.query<{ public_code: string | null; first_published_at: string | null }>(
        "select public_code, first_published_at from public.vacancies where id = $1",
        [vacancyId],
      );
    expect((await read(id)).rows[0]).toEqual({ public_code: null, first_published_at: null });

    // Misma sentencia que el backfill de 20261028000200_public_jobs_fixes.sql.
    await db.exec("update public.vacancies set status = status where status = 'publicada' and public_code is null");
    const first = (await read(id)).rows[0]!;
    expect(first.public_code).toMatch(/^[a-z0-9]{10}$/);
    expect(first.first_published_at).toBeTruthy();
    expect(await listedCodes()).toContain(first.public_code);
    expect((await read(closedId)).rows[0]!.public_code).toBeNull();

    await asActor(db, user(rrhh), () => db.query("update public.vacancies set title = 'Previa editada' where id = $1", [id]));
    expect((await read(id)).rows[0]).toEqual(first);
  });

  it("al editarla recibe código sin exigir los datos nuevos, pero no sale en las salidas públicas", async () => {
    const id = await insertLegacy(
      "insert into public.vacancies (title, department, description, status) values ('Previa corta', 'Operaciones', 'Corta', 'publicada') returning id",
    );
    await asActor(db, user(rrhh), () => db.query("update public.vacancies set department = 'Finanzas' where id = $1", [id]));
    const { rows } = await db.query<{ public_code: string | null }>("select public_code from public.vacancies where id = $1", [id]);
    expect(rows[0]!.public_code).toMatch(/^[a-z0-9]{10}$/);
    expect(await listedCodes()).not.toContain(rows[0]!.public_code);
  });
});
