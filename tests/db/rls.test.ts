import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addRequirement,
  anon,
  approveCriteria,
  asActor,
  createApplication,
  createCandidate,
  createTestDatabase,
  createUser,
  createVacancy,
  expectError,
  user,
} from "./harness";

let db: PGlite;
const ids = {} as {
  admin: string;
  rrhh: string;
  otroRrhh: string;
  inactivo: string;
  vacanteA: string;
  vacanteB: string;
  candidatoA: string;
  candidatoB: string;
  postulacionA: string;
  postulacionB: string;
  requisitoA: string;
  cvA: string;
  cvB: string;
};

async function insertResume(candidateId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.resumes (candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
     values ($1::uuid, 'candidates/' || $1::text || '/' || gen_random_uuid() || '.pdf', 'cv.pdf', 'application/pdf', 1000, repeat('a', 64))
     returning id`,
    [candidateId],
  );
  const resumeId = rows[0]!.id;
  await db.query(
    `insert into storage.objects (bucket_id, name) select 'resumes', storage_path from public.resumes where id = $1`,
    [resumeId],
  );
  return resumeId;
}

beforeAll(async () => {
  db = await createTestDatabase();
  ids.admin = await createUser(db, "admin", "Admin Ficticio");
  ids.rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  ids.otroRrhh = await createUser(db, "rrhh", "Otro RRHH Ficticio");
  ids.inactivo = await createUser(db, "rrhh", "RRHH Inactivo");
  await db.query("update public.profiles set is_active = false where id = $1", [ids.inactivo]);

  ids.vacanteA = await createVacancy(db, { title: "Analista de datos" });
  ids.vacanteB = await createVacancy(db, { title: "Contador senior" });
  ids.requisitoA = await addRequirement(db, ids.vacanteA, { description: "SQL", weight: 3 });
  await approveCriteria(db, ids.vacanteA);

  ids.candidatoA = await createCandidate(db, "Lucía Ficticia Rojas");
  ids.candidatoB = await createCandidate(db, "Mario Ficticio Soto");
  ids.postulacionA = await createApplication(db, ids.candidatoA, ids.vacanteA);
  ids.postulacionB = await createApplication(db, ids.candidatoB, ids.vacanteB);
  ids.cvA = await insertResume(ids.candidatoA);
  ids.cvB = await insertResume(ids.candidatoB);
});

afterAll(async () => {
  await db?.close();
});

describe("usuario no autenticado (anon)", () => {
  it("no puede consultar datos privados", async () => {
    for (const table of ["candidates", "resumes", "vacancies", "profiles", "applications", "audit_logs"]) {
      const error = await asActor(db, anon, () => expectError(db.query(`select * from public.${table}`)));
      expect(error.message).toMatch(/permission denied/);
    }
  });

  it("no puede ejecutar funciones del servidor", async () => {
    const error = await asActor(db, anon, () =>
      expectError(db.query("select public.get_dashboard_summary()")),
    );
    expect(error.message).toMatch(/permission denied/);
  });

  it("no puede leer archivos del bucket de CV", async () => {
    const { rows } = await asActor(db, anon, () =>
      db.query("select name from storage.objects where bucket_id = 'resumes'"),
    );
    expect(rows).toEqual([]);
  });
});

describe("observaciones", () => {
  it("se registran con su autor y no permiten falsificar otros tipos de evento", async () => {
    await asActor(db, user(ids.rrhh), async () => {
      await db.query(
        "insert into public.application_events (application_id, event_type, note) values ($1, 'observacion', 'Buen manejo de SQL')",
        [ids.postulacionA],
      );
      const forged = await expectError(
        db.query(
          "insert into public.application_events (application_id, event_type, note) values ($1, 'evaluacion_generada', 'Falso')",
          [ids.postulacionA],
        ),
      );
      expect(forged.message).toMatch(/row-level security/);
    });

    const { rows } = await db.query<{ actor_id: string }>(
      "select actor_id from public.application_events where event_type = 'observacion'",
    );
    expect(rows).toEqual([{ actor_id: ids.rrhh }]);
  });
});

describe("RRHH", () => {
  it("ve todas las vacantes y candidatos", async () => {
    await asActor(db, user(ids.rrhh), async () => {
      expect((await db.query("select id from public.vacancies")).rows).toHaveLength(2);
      expect((await db.query("select id from public.candidates")).rows).toHaveLength(2);
    });
  });

  it("no puede modificar el estado de una postulación sin pasar por la función de cambio de estado", async () => {
    const error = await asActor(db, user(ids.rrhh), () =>
      expectError(
        db.query("update public.applications set status = 'seleccionado' where id = $1", [ids.postulacionA]),
      ),
    );
    expect(error.message).toMatch(/permission denied/);
  });

  it("no puede autopromoverse a administrador", async () => {
    const result = await asActor(db, user(ids.rrhh), () =>
      db.query("update public.profiles set role = 'admin' where id = $1", [ids.rrhh]),
    );
    expect(result.affectedRows).toBe(0);
  });

  it("no puede consultar ni alterar la auditoría", async () => {
    await asActor(db, user(ids.rrhh), async () => {
      expect((await db.query("select id from public.audit_logs")).rows).toEqual([]);
      const error = await expectError(db.query("delete from public.audit_logs"));
      expect(error.message).toMatch(/permission denied/);
    });
  });

  it("tampoco lee, sube ni borra archivos del bucket directamente (lo hace el servidor)", async () => {
    await asActor(db, user(ids.rrhh), async () => {
      expect((await db.query("select name from storage.objects where bucket_id = 'resumes'")).rows).toEqual([]);
      const upload = await expectError(
        db.query("insert into storage.objects (bucket_id, name) values ('resumes', $1)", [
          `candidates/${ids.candidatoA}/otro.pdf`,
        ]),
      );
      expect(upload.message).toMatch(/row-level security/);
      expect((await db.query("delete from storage.objects where bucket_id = 'resumes'")).affectedRows).toBe(0);
    });
  });

  it("no puede insertar CV ni extracciones fuera de la función de registro", async () => {
    await asActor(db, user(ids.rrhh), async () => {
      const resume = await expectError(
        db.query(
          `insert into public.resumes (candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
           values ($1::uuid, 'candidates/' || $1::text || '/x.pdf', 'x.pdf', 'application/pdf', 10, repeat('d', 64))`,
          [ids.candidatoA],
        ),
      );
      expect(resume.message).toMatch(/permission denied/);
      const extraction = await expectError(
        db.query(
          "insert into public.resume_extractions (resume_id, status, method, extractor_version) values ($1, 'completada', 'pdf_text', 'x')",
          [ids.cvA],
        ),
      );
      expect(extraction.message).toMatch(/permission denied/);
    });
  });

  it("no puede eliminar CV (solo administración)", async () => {
    const result = await asActor(db, user(ids.rrhh), () =>
      db.query("delete from public.resumes where id = $1", [ids.cvA]),
    );
    expect(result.affectedRows).toBe(0);
  });
});

describe("usuario desactivado", () => {
  it("pierde el acceso a los datos pero puede ver su propio perfil", async () => {
    await asActor(db, user(ids.inactivo), async () => {
      expect((await db.query("select id from public.vacancies")).rows).toEqual([]);
      expect((await db.query("select id from public.candidates")).rows).toEqual([]);
      const profiles = await db.query<{ id: string; is_active: boolean }>(
        "select id, is_active from public.profiles",
      );
      expect(profiles.rows).toEqual([{ id: ids.inactivo, is_active: false }]);
    });
  });
});

describe("administrador", () => {
  it("consulta la auditoría sin contenido de datos personales", async () => {
    await db.query("update public.candidates set email = 'nuevo@correo.test' where id = $1", [ids.candidatoA]);
    const { rows } = await asActor(db, user(ids.admin), () =>
      db.query<{ metadata: Record<string, unknown> }>(
        `select metadata from public.audit_logs
          where entity_type = 'candidates' and action = 'update' and entity_id = $1`,
        [ids.candidatoA],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toEqual({ changed_fields: ["email", "email_normalized"] });
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain("nuevo@correo.test");
  });

  it("gestiona roles pero no puede dejar el sistema sin administradores activos", async () => {
    await asActor(db, user(ids.admin), async () => {
      const error = await expectError(
        db.query("update public.profiles set is_active = false where id = $1", [ids.admin]),
      );
      expect(error.message).toMatch(/al menos un administrador activo/);

      const promoted = await db.query("update public.profiles set role = 'admin' where id = $1", [ids.otroRrhh]);
      expect(promoted.affectedRows).toBe(1);
    });
    await db.query("update public.profiles set role = 'rrhh' where id = $1", [ids.otroRrhh]);
  });

  it("nadie puede modificar registros de auditoría", async () => {
    const error = await expectError(db.query("update public.audit_logs set action = 'x'"));
    expect(error.message).toMatch(/no se pueden modificar/);
  });
});
