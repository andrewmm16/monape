import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createCandidate, createTestDatabase, createUser, expectError, user } from "./harness";

/** Barrido de archivos huérfanos del bucket de CV (list_orphan_resume_files). */
let db: PGlite;
let admin: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin", "Admin");
});

afterAll(async () => {
  await db.close();
});

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function putObject(name: string, ageHours: number) {
  await db.query(
    `insert into storage.objects (bucket_id, name, created_at, updated_at)
     values ('resumes', $1, now() - make_interval(hours => $2), now() - make_interval(hours => $2))`,
    [name, ageHours],
  );
}

async function addResume(candidateId: string): Promise<string> {
  const path = `candidates/${candidateId}/${randomUUID()}.pdf`;
  await db.query(
    `insert into public.resumes (candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
     values ($1, $2, 'cv.pdf', 'application/pdf', 1000, $3)`,
    [candidateId, path, "a".repeat(64)],
  );
  return path;
}

const orphans = () =>
  asService(() => db.query<{ name: string }>("select name from public.list_orphan_resume_files(48, 1000)")).then((r) =>
    r.rows.map((row) => row.name).sort(),
  );

describe("list_orphan_resume_files", () => {
  it("devuelve solo archivos viejos que nada referencia, en las carpetas de la aplicación", async () => {
    const kept = await addResume(await createCandidate(db));
    await putObject(kept, 100);

    // Candidato eliminado: su CV deja de estar referenciado.
    const deletedCandidate = await createCandidate(db, "Candidato Eliminado");
    const deletedPath = await addResume(deletedCandidate);
    await putObject(deletedPath, 100);
    await db.query("delete from public.candidates where id = $1", [deletedCandidate]);

    // Subida que no llegó a registrarse: vieja (se borra) y reciente (se respeta).
    const stale = `candidates/${randomUUID()}/${randomUUID()}.pdf`;
    const fresh = `candidates/${randomUUID()}/${randomUUID()}.pdf`;
    await putObject(stale, 72);
    await putObject(fresh, 3);
    const staleIntake = `intake/${randomUUID()}/${randomUUID()}.pdf`;
    await putObject(staleIntake, 72);

    // Fuera de las carpetas conocidas: nunca se toca.
    await putObject(`otros/${randomUUID()}.pdf`, 500);

    expect(await orphans()).toEqual([deletedPath, stale, staleIntake].sort());
  });

  it("respeta los archivos de un lote de carga masiva pendiente", async () => {
    const { rows: vacancy } = await db.query<{ id: string }>(
      "insert into public.vacancies (title, department) values ('Analista', 'Operaciones') returning id",
    );
    const { rows: created } = await db.query<{ id: string }>(
      `insert into public.intake_batches (vacancy_id, portal_id, created_by)
       select $1, p.id, $2 from public.job_portals p limit 1 returning id`,
      [vacancy[0]!.id, admin],
    );
    const batchId = created[0]!.id;
    const itemId = randomUUID();
    const path = `intake/${batchId}/${itemId}.pdf`;
    await db.query(
      `insert into public.intake_batch_items (id, batch_id, status, original_filename, storage_path)
       values ($1, $2, 'listo', 'cv.pdf', $3)`,
      [itemId, batchId, path],
    );
    await putObject(path, 100);
    expect(await orphans()).not.toContain(path);
  });

  it("solo la clave de servicio, con margen mínimo de 24 h", async () => {
    await expectError(asActor(db, user(admin), () => db.query("select * from public.list_orphan_resume_files()")));
    const error = await expectError(asService(() => db.query("select * from public.list_orphan_resume_files(1, 10)")));
    expect(error.message).toMatch(/24 horas/);
  });
});
