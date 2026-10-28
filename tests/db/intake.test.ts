import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { anon, asActor, createTestDatabase, createUser, createVacancy, expectError, user } from "./harness";

let db: PGlite;
let admin: string;
let rrhh: string;
let sinRol: string;
let vacancyId: string;
let portalId: string;

const EXTRACTOR = "extractor-v1";
const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin Ficticio");
  rrhh = await createUser(db, "rrhh", "RRHH Ficticia");
  // Cuenta desactivada: conserva el JWT pero ya no es personal.
  sinRol = await createUser(db, "rrhh", "Persona Desactivada");
  await db.query("update public.profiles set is_active = false where id = $1", [sinRol]);
  vacancyId = await createVacancy(db);
  const { rows } = await db.query<{ id: string }>("select id from public.job_portals where name = 'Computrabajo'");
  portalId = rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

/** Un lote abierto por vacante y usuario: cada prueba usa una vacante propia. */
async function openBatch(actor = rrhh, vacancy?: string): Promise<string> {
  const vacancyForBatch = vacancy ?? (await createVacancy(db, { title: `Vacante ${randomUUID().slice(0, 6)}` }));
  return asActor(db, user(actor), async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.intake_batches (vacancy_id, portal_id) values ($1, $2) returning id",
      [vacancyForBatch, portalId],
    );
    return rows[0]!.id;
  });
}

type ItemValues = Partial<{
  fullName: string | null;
  email: string | null;
  phone: string | null;
  sha: string;
  nameFromCv: boolean;
  suggested: object;
  storagePath: string;
}>;

async function addItem(batchId: string, values: ItemValues = {}, actor = rrhh): Promise<string> {
  const itemId = randomUUID();
  await asActor(db, user(actor), () =>
    db.query(
      `insert into public.intake_batch_items (
         id, batch_id, status, original_filename, storage_path, mime_type, size_bytes, sha256,
         extraction_status, extraction_method, raw_text, suggested_fields, warnings,
         full_name, email, phone, name_from_cv
       ) values (
         $1, $2, 'listo', 'cv.pdf', $3, 'application/pdf', 1000, $4,
         'completada', 'pdf_text', 'Texto del CV de prueba', $5::jsonb, '{}',
         $6, $7, $8, $9
       )`,
      [
        itemId,
        batchId,
        values.storagePath ?? `intake/${batchId}/${itemId}.pdf`,
        values.sha ?? sha(),
        JSON.stringify(values.suggested ?? {}),
        values.fullName === undefined ? "Lucía Ramos Ficticia" : values.fullName,
        values.email === undefined ? `${itemId.slice(0, 8)}@correo.test` : values.email,
        values.phone === undefined ? "+51 987 654 321" : values.phone,
        values.nameFromCv ?? false,
      ],
    ),
  );
  return itemId;
}

const register = (itemId: string, actor = rrhh) => {
  const candidateId = randomUUID();
  const resumeId = randomUUID();
  return asActor(db, user(actor), async () => {
    const { rows } = await db.query<{ register_batch_item: string }>(
      "select public.register_batch_item($1, $2, $3, $4, $5)",
      [itemId, candidateId, resumeId, `candidates/${candidateId}/${resumeId}.pdf`, EXTRACTOR],
    );
    return { applicationId: rows[0]!.register_batch_item, candidateId, resumeId };
  });
};

describe("catálogo de portales", () => {
  it("se carga con automáticos, manuales y «Otro»", async () => {
    const { rows } = await db.query<{ name: string; kind: string }>("select name, kind from public.job_portals");
    const byName = new Map(rows.map((r) => [r.name, r.kind]));
    expect(rows).toHaveLength(18);
    for (const name of ["Página de empleos", "Google", "Talent.com", "Jooble", "Trovit", "Careerjet", "OpcionEmpleo", "JobTome", "JobisJob"]) {
      expect(byName.get(name)).toBe("automatico");
    }
    for (const name of ["LinkedIn", "Computrabajo", "Indeed", "Bumeran", "Get on Board", "Torre", "Empleos Perú", "Trabajos Diarios", "Otro"]) {
      expect(byName.get(name)).toBe("manual");
    }
  });

  it("el personal lo lee, solo administración lo modifica y anon no accede", async () => {
    const read = await asActor(db, user(rrhh), () => db.query("select id from public.job_portals"));
    expect(read.rows).toHaveLength(18);
    const none = await asActor(db, user(sinRol), () => db.query("select id from public.job_portals"));
    expect(none.rows).toHaveLength(0);

    const denied = await asActor(db, user(rrhh), () =>
      expectError(db.query("insert into public.job_portals (name, kind, candidate_source) values ('Nuevo', 'manual', 'otro')")),
    );
    expect(denied.message).toMatch(/row-level security/);
    const renamed = await asActor(db, user(rrhh), () =>
      db.query("update public.job_portals set is_active = false where name = 'Indeed' returning id"),
    );
    expect(renamed.rows).toHaveLength(0);

    await asActor(db, user(admin), () =>
      db.query("insert into public.job_portals (name, kind, candidate_source) values ('Portal de prueba', 'manual', 'otro')"),
    );
    const anonRead = await asActor(db, anon, () => expectError(db.query("select id from public.job_portals")));
    expect(anonRead.message).toMatch(/permission denied/);
  });
});

describe("registro de un ítem", () => {
  it("crea candidato, CV, extracción y postulación con portal y método, en una transacción", async () => {
    const batchId = await openBatch(rrhh, vacancyId);
    const itemId = await addItem(batchId, {
      fullName: "Marta Quispe Ficticia",
      email: "Marta.Quispe@Correo.test",
      phone: "999 111 222",
      nameFromCv: true,
      suggested: { email: { value: "marta.quispe@correo.test", evidence: "x" }, phone: { value: "999111222", evidence: "x" } },
    });
    const { applicationId, candidateId, resumeId } = await register(itemId);

    const candidate = await db.query<{ source: string; source_detail: string; field_origins: Record<string, string>; created_by: string }>(
      "select source, source_detail, field_origins, created_by from public.candidates where id = $1",
      [candidateId],
    );
    expect(candidate.rows[0]).toMatchObject({
      source: "bolsa_empleo",
      source_detail: "Computrabajo",
      created_by: rrhh,
      field_origins: { full_name: "extraido", email: "extraido", phone: "extraido" },
    });

    const extraction = await db.query<{ raw_text: string; status: string }>(
      "select e.raw_text, e.status from public.resume_extractions e where e.resume_id = $1",
      [resumeId],
    );
    expect(extraction.rows[0]).toMatchObject({ raw_text: "Texto del CV de prueba", status: "completada" });

    const application = await db.query<{ portal_id: string; intake_method: string; resume_id: string; vacancy_id: string; status: string }>(
      "select portal_id, intake_method, resume_id, vacancy_id, status from public.applications where id = $1",
      [applicationId],
    );
    expect(application.rows[0]).toEqual({
      portal_id: portalId,
      intake_method: "carga_masiva",
      resume_id: resumeId,
      vacancy_id: vacancyId,
      status: "nuevo",
    });

    const item = await db.query<Record<string, unknown>>(
      "select status, raw_text, storage_path, candidate_id, application_id, email, phone, suggested_fields, full_name from public.intake_batch_items where id = $1",
      [itemId],
    );
    // El ítem no conserva datos personales más allá del nombre (que sigue mientras exista el candidato).
    expect(item.rows[0]).toEqual({
      status: "registrado",
      raw_text: null,
      storage_path: null,
      email: null,
      phone: null,
      suggested_fields: {},
      full_name: "Marta Quispe Ficticia",
      candidate_id: candidateId,
      application_id: applicationId,
    });

    const audit = await db.query<{ metadata: Record<string, string> }>(
      "select metadata from public.audit_logs where action = 'carga_masiva' and entity_id = $1",
      [applicationId],
    );
    expect(audit.rows[0]!.metadata).toMatchObject({ intake_method: "carga_masiva", portal: "Computrabajo", portal_id: portalId });
  });

  it("marca como declarados los valores que RRHH escribió", async () => {
    const batchId = await openBatch(admin);
    const itemId = await addItem(batchId, { fullName: "Pedro Ficticio Soto", email: "otro@correo.test", phone: null, nameFromCv: false, suggested: { email: { value: "distinto@correo.test", evidence: "x" } } }, admin);
    const { candidateId } = await register(itemId, admin);
    const { rows } = await db.query<{ field_origins: Record<string, string> }>(
      "select field_origins from public.candidates where id = $1",
      [candidateId],
    );
    expect(rows[0]!.field_origins).toEqual({ full_name: "declarado", email: "declarado" });
  });

  it("un ítem registrado no se registra dos veces", async () => {
    const batchId = await openBatch(admin);
    const itemId = await addItem(batchId, {}, admin);
    await register(itemId, admin);
    const again = await expectError(register(itemId, admin));
    expect(again.message).toMatch(/ya fue registrado/);
    const { rows } = await db.query<{ total: number }>(
      "select count(*)::int as total from public.applications a join public.intake_batch_items i on i.candidate_id = a.candidate_id where i.id = $1",
      [itemId],
    );
    expect(rows[0]!.total).toBe(1);
  });

  it("sin nombre no se registra, y un fallo no deja datos a medias", async () => {
    const batchId = await openBatch(admin);
    const noName = await addItem(batchId, { fullName: null }, admin);
    const status = await db.query<{ status: string }>("select status from public.intake_batch_items where id = $1", [noName]);
    expect(status.rows[0]!.status).toBe("requiere_datos");
    expect((await expectError(register(noName, admin))).message).toMatch(/Falta el nombre/);

    const countAll = async () =>
      (
        await db.query<Record<string, number>>(
          `select (select count(*) from public.candidates)::int as candidates,
                  (select count(*) from public.resumes)::int as resumes,
                  (select count(*) from public.resume_extractions)::int as extractions,
                  (select count(*) from public.applications)::int as applications`,
        )
      ).rows[0]!;
    const before = await countAll();
    // Vacante cerrada: el disparador rechaza la postulación al final de la función.
    const closed = await createVacancy(db, { status: "cerrada", title: "Vacante cerrada" });
    const closedBatch = await openBatch(admin, closed);
    const item = await addItem(closedBatch, {}, admin);
    expect((await expectError(register(item, admin))).message).toMatch(/no admite nuevas postulaciones/);
    // Nada a medias: ni candidato, ni CV, ni extracción, ni postulación.
    expect(await countAll()).toEqual(before);
    const state = await db.query<{ status: string; raw_text: string | null }>(
      "select status, raw_text from public.intake_batch_items where id = $1",
      [item],
    );
    expect(state.rows[0]).toEqual({ status: "listo", raw_text: "Texto del CV de prueba" });
  });

  it("un lote cerrado no admite registros", async () => {
    const batchId = await openBatch(admin);
    const itemId = await addItem(batchId, {}, admin);
    await db.query("update public.intake_batches set status = 'cerrado', closed_at = now() where id = $1", [batchId]);
    expect((await expectError(register(itemId, admin))).message).toMatch(/cerrado/);
  });
});

describe("acceso", () => {
  it("quien no es personal no ve ni registra lotes", async () => {
    const batchId = await openBatch();
    const itemId = await addItem(batchId);

    const batches = await asActor(db, user(sinRol), () => db.query("select id from public.intake_batches"));
    const items = await asActor(db, user(sinRol), () => db.query("select id from public.intake_batch_items"));
    expect(batches.rows).toEqual([]);
    expect(items.rows).toEqual([]);

    expect((await expectError(register(itemId, sinRol))).message).toMatch(/No autorizado/);
    expect((await expectError(openBatch(sinRol))).message).toMatch(/row-level security/);
    expect((await expectError(addItem(batchId, {}, sinRol))).message).toMatch(/row-level security/);
    const dups = await asActor(db, user(sinRol), () => db.query("select * from public.batch_item_duplicates($1)", [batchId]));
    expect(dups.rows).toEqual([]);

    const anonTry = await asActor(db, anon, () => expectError(db.query("select id from public.intake_batches")));
    expect(anonTry.message).toMatch(/permission denied/);
    const anonRegister = await asActor(db, anon, () =>
      expectError(db.query("select public.register_batch_item($1, $2, $3, 'candidates/x/y.pdf', 'v')", [itemId, randomUUID(), randomUUID()])),
    );
    expect(anonRegister.message).toMatch(/permission denied/);
  });

  it("intake_method y portal_id no se pueden escribir directamente", async () => {
    const candidate = await db.query<{ id: string }>(
      "insert into public.candidates (full_name) values ('Persona Directa') returning id",
    );
    const insertMethod = await asActor(db, user(rrhh), () =>
      expectError(
        db.query("insert into public.applications (candidate_id, vacancy_id, intake_method) values ($1, $2, 'carga_masiva')", [
          candidate.rows[0]!.id,
          vacancyId,
        ]),
      ),
    );
    expect(insertMethod.message).toMatch(/permission denied/);
    const insertPortal = await asActor(db, user(admin), () =>
      expectError(
        db.query("insert into public.applications (candidate_id, vacancy_id, portal_id) values ($1, $2, $3)", [
          candidate.rows[0]!.id,
          vacancyId,
          portalId,
        ]),
      ),
    );
    expect(insertPortal.message).toMatch(/permission denied/);

    const { rows } = await db.query<{ id: string }>(
      "insert into public.applications (candidate_id, vacancy_id) values ($1, $2) returning id",
      [candidate.rows[0]!.id, vacancyId],
    );
    for (const column of ["intake_method = 'integracion'", `portal_id = '${portalId}'`]) {
      const update = await asActor(db, user(rrhh), () =>
        expectError(db.query(`update public.applications set ${column} where id = $1`, [rows[0]!.id])),
      );
      expect(update.message).toMatch(/permission denied/);
    }
    const manual = await db.query<{ intake_method: string; portal_id: string | null }>(
      "select intake_method, portal_id from public.applications where id = $1",
      [rows[0]!.id],
    );
    expect(manual.rows[0]).toEqual({ intake_method: "manual", portal_id: null });
  });

  it("los ítems no se pueden marcar como registrados ni enlazar a un candidato desde la sesión", async () => {
    const batchId = await openBatch();
    const itemId = await addItem(batchId);
    const mark = await asActor(db, user(rrhh), () =>
      expectError(db.query("update public.intake_batch_items set status = 'registrado' where id = $1", [itemId])),
    );
    expect(mark.message).toMatch(/permission denied/);
    const insert = await asActor(db, user(rrhh), () =>
      expectError(
        db.query(
          "insert into public.intake_batch_items (batch_id, status, original_filename, application_id) values ($1, 'error', 'x.pdf', $2)",
          [batchId, randomUUID()],
        ),
      ),
    );
    expect(insert.message).toMatch(/permission denied/);
  });
});

describe("ítems del lote", () => {
  it("recalcula el estado según haya nombre y limita el lote a 50 ítems", async () => {
    const batchId = await openBatch(admin);
    const itemId = await addItem(batchId, { fullName: null }, admin);
    const read = async () =>
      (await db.query<{ status: string }>("select status from public.intake_batch_items where id = $1", [itemId])).rows[0]!.status;
    expect(await read()).toBe("requiere_datos");
    await asActor(db, user(admin), () =>
      db.query("update public.intake_batch_items set full_name = 'Nombre Corregido' where id = $1", [itemId]),
    );
    expect(await read()).toBe("listo");
    await asActor(db, user(admin), () =>
      db.query("update public.intake_batch_items set full_name = '  ' where id = $1", [itemId]),
    );
    expect(await read()).toBe("requiere_datos");

    for (let i = 1; i < 50; i += 1) await addItem(batchId, {}, admin);
    expect((await expectError(addItem(batchId, {}, admin))).message).toMatch(/50 archivos/);
  });

  it("el mismo archivo (SHA-256) no se repite en un lote", async () => {
    const batchId = await openBatch(admin);
    const hash = sha();
    await addItem(batchId, { sha: hash }, admin);
    expect((await expectError(addItem(batchId, { sha: hash }, admin))).message).toMatch(/duplicate key/);
  });

  it("solo hay un lote abierto por vacante y usuario", async () => {
    const vacancy = await createVacancy(db, { title: "Vacante con un lote" });
    await openBatch(rrhh, vacancy);
    expect((await expectError(openBatch(rrhh, vacancy))).message).toMatch(/duplicate key/);
    await openBatch(admin, vacancy);
  });
});

describe("posibles duplicados", () => {
  it("encuentra candidatos por correo, teléfono, nombre y por el SHA-256 de un CV ya cargado", async () => {
    const existing = await db.query<{ id: string }>(
      "insert into public.candidates (full_name, email, phone) values ('Rosa Duplicada Ficticia', 'rosa@correo.test', '955 444 333') returning id",
    );
    const candidateId = existing.rows[0]!.id;
    const cvHash = sha();
    await db.query(
      `insert into public.resumes (candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
       values ($1, $2, 'cv.pdf', 'application/pdf', 100, $3)`,
      [candidateId, `candidates/${candidateId}/${randomUUID()}.pdf`, cvHash],
    );

    const batchId = await openBatch(admin);
    const byEmail = await addItem(batchId, { fullName: "Otra Persona Distinta", email: "ROSA@correo.test", phone: null }, admin);
    const byPhone = await addItem(batchId, { fullName: "Otra Persona Tres", email: null, phone: "+51 955-444-333" }, admin);
    const byName = await addItem(batchId, { fullName: "rosa duplicada ficticia", email: null, phone: null }, admin);
    const byHash = await addItem(batchId, { fullName: "Persona Con El Mismo CV", email: null, phone: null, sha: cvHash }, admin);
    const clean = await addItem(batchId, { fullName: "Persona Sin Coincidencias", email: "libre@correo.test", phone: "911 000 111" }, admin);

    const { rows } = await asActor(db, user(admin), () =>
      db.query<{ item_id: string; candidate_id: string; match_reasons: string[] }>(
        "select item_id, candidate_id, match_reasons from public.batch_item_duplicates($1)",
        [batchId],
      ),
    );
    const reasons = (itemId: string) => rows.filter((r) => r.item_id === itemId).map((r) => r.match_reasons);
    expect(reasons(byEmail)).toEqual([["correo"]]);
    expect(reasons(byPhone)).toEqual([["telefono"]]);
    expect(reasons(byName)).toEqual([["nombre"]]);
    expect(reasons(byHash)).toEqual([["cv"]]);
    expect(reasons(clean)).toEqual([]);
    expect(rows.every((r) => r.candidate_id === candidateId)).toBe(true);
  });
});

describe("límite cv_bulk_upload", () => {
  it("permite 100 archivos cada 10 minutos por usuario y rechaza el 101", async () => {
    const results = await asActor(db, user(admin), async () => {
      const values: boolean[] = [];
      for (let i = 0; i < 101; i += 1) {
        const { rows } = await db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('cv_bulk_upload')");
        values.push(rows[0]!.consume_rate_limit);
      }
      return values;
    });
    expect(results.slice(0, 100).every(Boolean)).toBe(true);
    expect(results[100]).toBe(false);

    // Otro usuario tiene su propio contador y los demás tipos no cambian.
    const other = await asActor(db, user(rrhh), () => db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('cv_bulk_upload')"));
    expect(other.rows[0]!.consume_rate_limit).toBe(true);
    const legacy = await asActor(db, user(rrhh), () => db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('cv_upload')"));
    expect(legacy.rows[0]!.consume_rate_limit).toBe(true);
  });
});

describe("límite evaluation_bulk", () => {
  it("permite 40 llamadas cada 10 minutos por usuario y rechaza la 41", async () => {
    const results = await asActor(db, user(admin), async () => {
      const values: boolean[] = [];
      for (let i = 0; i < 41; i += 1) {
        const { rows } = await db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('evaluation_bulk')");
        values.push(rows[0]!.consume_rate_limit);
      }
      return values;
    });
    expect(results.slice(0, 40).every(Boolean)).toBe(true);
    expect(results[40]).toBe(false);

    // Otro usuario tiene su propio contador y los demás tipos no cambian.
    const other = await asActor(db, user(rrhh), () => db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('evaluation_bulk')"));
    expect(other.rows[0]!.consume_rate_limit).toBe(true);
    const individual = await asActor(db, user(rrhh), () => db.query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit('evaluation')"));
    expect(individual.rows[0]!.consume_rate_limit).toBe(true);
  });
});

describe("bandeja de entrada", () => {
  it("application_overview expone portal y método de ingreso", async () => {
    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ portal_name: string | null; intake_method: string }>(
        "select portal_name, intake_method from public.application_overview where intake_method = 'carga_masiva' limit 1",
      ),
    );
    expect(rows[0]).toEqual({ portal_name: "Computrabajo", intake_method: "carga_masiva" });
  });
});

describe("endurecimiento del lote", () => {
  it("borrar al candidato borra el ítem que lo registró", async () => {
    const batchId = await openBatch(admin);
    const itemId = await addItem(batchId, {}, admin);
    const { candidateId } = await register(itemId, admin);
    await db.query("delete from public.candidates where id = $1", [candidateId]);
    const { rows } = await db.query("select id from public.intake_batch_items where id = $1", [itemId]);
    expect(rows).toEqual([]);
  });

  it("el cierre solo se hace con close_intake_batch: el UPDATE directo se rechaza", async () => {
    const batchId = await openBatch(admin);
    for (const sql of [
      "update public.intake_batches set status = 'cerrado', closed_at = now() where id = $1",
      "update public.intake_batches set closed_at = now() where id = $1",
    ]) {
      const denied = await asActor(db, user(admin), () => expectError(db.query(sql, [batchId])));
      expect(denied.message).toMatch(/permission denied/);
    }
    const { rows } = await db.query<{ status: string }>("select status from public.intake_batches where id = $1", [batchId]);
    expect(rows[0]!.status).toBe("abierto");
  });

  it("close_intake_batch borra los pendientes, devuelve sus rutas y conserva los registrados", async () => {
    const batchId = await openBatch(admin);
    const pendingA = await addItem(batchId, {}, admin);
    const pendingB = await addItem(batchId, { fullName: null }, admin);
    const done = await addItem(batchId, {}, admin);
    await register(done, admin);
    await asActor(db, user(admin), () =>
      db.query("insert into public.intake_batch_items (batch_id, status, original_filename, error_code) values ($1, 'error', 'malo.pdf', 'archivo_invalido')", [batchId]),
    );

    const { rows } = await asActor(db, user(admin), () =>
      db.query<{ close_intake_batch: string[] }>("select public.close_intake_batch($1)", [batchId]),
    );
    expect(rows[0]!.close_intake_batch.sort()).toEqual(
      [`intake/${batchId}/${pendingA}.pdf`, `intake/${batchId}/${pendingB}.pdf`].sort(),
    );
    const left = await db.query<{ id: string; status: string }>("select id, status from public.intake_batch_items where batch_id = $1", [batchId]);
    expect(left.rows).toEqual([{ id: done, status: "registrado" }]);
    const batch = await db.query<{ status: string; closed_at: string | null }>("select status, closed_at from public.intake_batches where id = $1", [batchId]);
    expect(batch.rows[0]!.status).toBe("cerrado");
    expect(batch.rows[0]!.closed_at).not.toBeNull();

    expect((await expectError(asActor(db, user(admin), () => db.query("select public.close_intake_batch($1)", [batchId])))).message).toMatch(/ya está cerrado/);
  });

  it("close_intake_batch solo lo usa el personal", async () => {
    const batchId = await openBatch(admin);
    const noStaff = await asActor(db, user(sinRol), () => expectError(db.query("select public.close_intake_batch($1)", [batchId])));
    expect(noStaff.message).toMatch(/No autorizado/);
    const anonCall = await asActor(db, anon, () => expectError(db.query("select public.close_intake_batch($1)", [batchId])));
    expect(anonCall.message).toMatch(/permission denied/);
  });

  it("un lote cerrado no se reabre ni admite ítems nuevos o ediciones", async () => {
    const batchId = await openBatch(admin);
    const itemId = await addItem(batchId, {}, admin);
    await db.query("update public.intake_batches set status = 'cerrado', closed_at = now() where id = $1", [batchId]);

    expect((await expectError(db.query("update public.intake_batches set status = 'abierto', closed_at = null where id = $1", [batchId]))).message).toMatch(/no se puede reabrir/);
    expect((await expectError(addItem(batchId, {}, admin))).message).toMatch(/cerrado/);
    const error = await asActor(db, user(admin), () =>
      expectError(db.query("insert into public.intake_batch_items (batch_id, status, original_filename) values ($1, 'error', 'x.pdf')", [batchId])),
    );
    expect(error.message).toMatch(/cerrado/);
    const edit = await asActor(db, user(admin), () =>
      expectError(db.query("update public.intake_batch_items set full_name = 'Otro Nombre' where id = $1", [itemId])),
    );
    expect(edit.message).toMatch(/cerrado/);
    expect((await expectError(register(itemId, admin))).message).toMatch(/cerrado/);
  });

  it("storage_path debe ser exactamente intake/{lote}/{ítem}.{pdf|docx}", async () => {
    const batchId = await openBatch(admin);
    const otherBatch = await openBatch(rrhh);
    const bad = [
      `intake/${batchId}/../${otherBatch}/x.pdf`,
      `intake/${batchId}/../../candidates/x/y.pdf`,
      `intake/${otherBatch}/${randomUUID()}.pdf`,
      `intake/${batchId}/${randomUUID()}.pdf`,
      `candidates/${batchId}/x.pdf`,
    ];
    for (const storagePath of bad) {
      expect((await expectError(addItem(batchId, { storagePath }, admin))).message).toMatch(/intake_batch_items_path_check/);
    }
    const itemId = randomUUID();
    await asActor(db, user(admin), () =>
      db.query(
        "insert into public.intake_batch_items (id, batch_id, status, original_filename, storage_path) values ($1, $2, 'listo', 'a.docx', $3)",
        [itemId, batchId, `intake/${batchId}/${itemId}.docx`],
      ),
    );
  });
});
