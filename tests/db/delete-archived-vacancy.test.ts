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
 * public.delete_archived_vacancy: borrado en cascada, solo admin y solo sobre
 * vacantes archivadas. Elimina la vacante, sus postulaciones y su historial, y
 * los candidatos sin ninguna otra postulación; conserva a quienes tienen otra.
 */
let db: PGlite;
let adminId: string;
let rrhhId: string;

type DeleteResult = {
  deleted_applications: number;
  deleted_candidates: number;
  resume_paths: string[];
};

async function callDelete(actorId: string, vacancyId: string): Promise<DeleteResult> {
  return asActor(db, user(actorId), async () => {
    const { rows } = await db.query<{ result: DeleteResult }>(
      "select public.delete_archived_vacancy($1) as result",
      [vacancyId],
    );
    return rows[0]!.result;
  });
}

async function addResume(candidateId: string): Promise<string> {
  const path = `candidates/${candidateId}/cv.pdf`;
  await db.query(
    `insert into public.resumes (candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
     values ($1, $2, 'cv.pdf', 'application/pdf', 1024, repeat('a', 64))`,
    [candidateId, path],
  );
  return path;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: number }>(sql, params);
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  db = await createTestDatabase();
  adminId = await createUser(db, "admin", "Admin Ficticio");
  rrhhId = await createUser(db, "rrhh", "RRHH Ficticio");
});

afterAll(async () => {
  await db.close();
});

describe("delete_archived_vacancy", () => {
  it("rechaza a quien no es administrador", async () => {
    const vacancy = await createVacancy(db, { status: "archivada" });
    const error = await expectError(callDelete(rrhhId, vacancy));
    expect(error.message).toMatch(/autoriz/i);
    // La vacante sigue existiendo.
    expect(await count("select count(*)::int as n from public.vacancies where id = $1", [vacancy])).toBe(1);
  });

  it("rechaza vacantes que no están archivadas", async () => {
    const vacancy = await createVacancy(db, { status: "publicada" });
    const error = await expectError(callDelete(adminId, vacancy));
    expect(error.message).toMatch(/archivada/i);
    expect(await count("select count(*)::int as n from public.vacancies where id = $1", [vacancy])).toBe(1);
  });

  it("borra la vacante, sus postulaciones y los candidatos huérfanos; conserva a los que tienen otra postulación", async () => {
    // La vacante recibió postulaciones mientras estaba publicada y luego se archivó.
    const archived = await createVacancy(db, { title: "Archivada", status: "publicada" });
    const other = await createVacancy(db, { title: "Otra", status: "publicada" });

    // Candidato huérfano: solo postula a la archivada, con CV.
    const orphan = await createCandidate(db, "Huérfano Ficticio");
    await createApplication(db, orphan, archived);
    const orphanPath = await addResume(orphan);

    // Candidato con otra postulación: postula a la archivada y, una vez
    // archivada (su postulación deja de contar como «en proceso»), a otra vacante.
    const kept = await createCandidate(db, "Conservado Ficticio");
    await createApplication(db, kept, archived);

    await db.query("update public.vacancies set status = 'archivada' where id = $1", [archived]);
    await createApplication(db, kept, other);

    const result = await callDelete(adminId, archived);

    expect(result.deleted_applications).toBe(2);
    expect(result.deleted_candidates).toBe(1);
    expect(result.resume_paths).toEqual([orphanPath]);

    // La vacante archivada desaparece; la otra permanece.
    expect(await count("select count(*)::int as n from public.vacancies where id = $1", [archived])).toBe(0);
    expect(await count("select count(*)::int as n from public.vacancies where id = $1", [other])).toBe(1);

    // El huérfano y su CV desaparecen; el conservado queda con su postulación a la otra vacante.
    expect(await count("select count(*)::int as n from public.candidates where id = $1", [orphan])).toBe(0);
    expect(await count("select count(*)::int as n from public.resumes where candidate_id = $1", [orphan])).toBe(0);
    expect(await count("select count(*)::int as n from public.candidates where id = $1", [kept])).toBe(1);
    expect(await count("select count(*)::int as n from public.applications where candidate_id = $1", [kept])).toBe(1);
    expect(await count("select count(*)::int as n from public.applications where vacancy_id = $1", [archived])).toBe(0);
  });
});
