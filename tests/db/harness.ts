import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const SHIM_PATH = path.join(ROOT, "tests", "db", "supabase-shim.sql");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** Base de datos efímera: réplica mínima de Supabase + todas las migraciones. */
export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(SHIM_PATH, "utf8"));
  for (const file of migrationFiles()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

export type Actor = { kind: "anon" } | { kind: "user"; id: string };

/**
 * Ejecuta `fn` con los privilegios de un rol de PostgREST, simulando el JWT
 * que Supabase envía en cada solicitud. Fuera de `asActor` las consultas se
 * ejecutan como superusuario (equivalente a migraciones / clave de servicio).
 */
export async function asActor<T>(db: PGlite, actor: Actor, fn: () => Promise<T>): Promise<T> {
  const claims =
    actor.kind === "user" ? { sub: actor.id, role: "authenticated" } : { role: "anon" };
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${actor.kind === "user" ? "authenticated" : "anon"}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

export const user = (id: string): Actor => ({ kind: "user", id });
export const anon: Actor = { kind: "anon" };

type Role = "admin" | "rrhh";

export async function createUser(
  db: PGlite,
  role: Role,
  name = `Usuario ${role}`,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, $3, $4)`,
    [
      id,
      `${role}.${id.slice(0, 8)}@ejemplo.test`,
      JSON.stringify({ role }),
      JSON.stringify({ full_name: name }),
    ],
  );
  return id;
}

export async function createVacancy(
  db: PGlite,
  overrides: Partial<{ title: string; status: string }> = {},
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.vacancies (title, department, status)
     values ($1, 'Operaciones', $2::public.vacancy_status) returning id`,
    [overrides.title ?? "Analista de datos", overrides.status ?? "publicada"],
  );
  return rows[0]!.id;
}

export async function addRequirement(
  db: PGlite,
  vacancyId: string,
  values: { description: string; weight: number; priority?: string; category?: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.vacancy_requirements (vacancy_id, category, priority, description, weight)
     values ($1, $2::public.requirement_category, $3::public.requirement_priority, $4, $5)
     returning id`,
    [
      vacancyId,
      values.category ?? "habilidad_tecnica",
      values.priority ?? "obligatorio",
      values.description,
      values.weight,
    ],
  );
  return rows[0]!.id;
}

export async function createCandidate(db: PGlite, fullName = "Ana Pérez Ficticia"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.candidates (full_name, email, phone)
     values ($1, $2, '+51 999 111 222') returning id`,
    [fullName, `${randomUUID().slice(0, 8)}@correo.test`],
  );
  return rows[0]!.id;
}

export async function createApplication(
  db: PGlite,
  candidateId: string,
  vacancyId: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.applications (candidate_id, vacancy_id) values ($1, $2) returning id`,
    [candidateId, vacancyId],
  );
  return rows[0]!.id;
}

/** Aprueba criterios como superusuario (equivalente a un proceso de servicio). */
export async function approveCriteria(db: PGlite, vacancyId: string): Promise<number> {
  const { rows } = await db.query<{ criteria_version: number }>(
    `update public.vacancies
        set criteria_version = criteria_version + 1, criteria_approved_at = now()
      where id = $1 returning criteria_version`,
    [vacancyId],
  );
  return rows[0]!.criteria_version;
}

export async function expectError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Se esperaba un error y la operación se completó");
}
