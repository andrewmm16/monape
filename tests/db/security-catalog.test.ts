import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./harness";

/**
 * Revisión de seguridad del catálogo (RLS, privilegios y funciones con
 * privilegios elevados) sobre TODAS las migraciones. Son invariantes: si una
 * migración nueva rompe alguna, la prueba lo dice con el nombre del objeto.
 * Complementa las pruebas de comportamiento por tabla; no reemplaza una
 * revisión contra el proyecto Supabase real (docs/seguridad.md).
 */
let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function names(sql: string): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(sql);
  return rows.map((row) => row.name);
}

describe("catálogo de seguridad", () => {
  it("todas las tablas de public tienen RLS", async () => {
    expect(
      await names(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`),
    ).toEqual([]);
  });

  it("anon no tiene privilegios sobre tablas ni vistas de public", async () => {
    expect(
      await names(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
                     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
                       or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
                   order by 1`),
    ).toEqual([]);
  });

  it("anon no ejecuta funciones de public ni usa el esquema private", async () => {
    expect(
      await names(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`),
    ).toEqual([]);
    const { rows } = await db.query<{ usage: boolean }>("select has_schema_privilege('anon', 'private', 'usage') as usage");
    expect(rows[0]!.usage).toBe(false);
  });

  it("las vistas de public respetan la RLS de quien consulta (security_invoker)", async () => {
    expect(
      await names(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind in ('v', 'm')
                     and not ('security_invoker=true' = any (coalesce(c.reloptions, '{}'))) order by 1`),
    ).toEqual([]);
  });

  it("toda función SECURITY DEFINER fija su search_path", async () => {
    expect(
      await names(`select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private') and p.prosecdef
                     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
                   order by 1`),
    ).toEqual([]);
  });

  it("ninguna política de public es abierta (using/with check true)", async () => {
    expect(
      await names(`select tablename || '.' || policyname as name from pg_policies
                   where schemaname = 'public' and (qual = 'true' or with_check = 'true') order by 1`),
    ).toEqual([]);
  });

  it("cada privilegio de escritura de authenticated tiene su política", async () => {
    const missing = await names(`
      with grants as (
        select c.relname, 'DELETE' as cmd from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'delete')
        union
        select table_name, privilege_type from information_schema.column_privileges
        where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE')
      )
      select g.relname || ' ' || g.cmd as name from grants g
      where not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = g.relname and p.cmd in (g.cmd, 'ALL')
      )
      order by 1`);
    expect(missing).toEqual([]);
  });

  it("los CV solo se alcanzan por el servidor: bucket privado y sin políticas en storage.objects", async () => {
    const { rows } = await db.query<{ public: boolean }>("select public from storage.buckets where id = 'resumes'");
    expect(rows).toEqual([{ public: false }]);
    expect(await names("select policyname as name from pg_policies where schemaname = 'storage' and tablename = 'objects'")).toEqual(
      [],
    );
  });

  it("las funciones de las tareas programadas son solo para la clave de servicio", async () => {
    const serviceOnly = [
      "claim_due_interview_reminders",
      "finish_interview_reminder",
      "list_orphan_resume_files",
    ];
    expect(
      await names(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = any (array['${serviceOnly.join("','")}'])
                     and has_function_privilege('authenticated', p.oid, 'execute') order by 1`),
    ).toEqual([]);
  });
});
