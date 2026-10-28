import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, migrationFiles } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db?.close();
});

describe("migraciones", () => {
  it("se aplican en orden sobre una base de datos vacía", async () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(5);
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    expect(rows[0]!.total).toBeGreaterThanOrEqual(12);
  });

  it("todas las tablas del esquema public tienen RLS habilitado", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select c.relname
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("el rol anon no tiene privilegios sobre tablas, vistas ni funciones públicas", async () => {
    const tables = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'`,
    );
    expect(tables.rows).toEqual([]);

    const functions = await db.query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(functions.rows.map((r) => r.proname)).toEqual([]);
  });

  it("las vistas consultan con los permisos del usuario (security_invoker)", async () => {
    const { rows } = await db.query<{ relname: string; reloptions: string[] | null }>(
      `select c.relname, c.reloptions
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const view of rows) {
      expect(view.reloptions ?? []).toContain("security_invoker=true");
    }
  });

  it("las funciones SECURITY DEFINER fijan search_path vacío", async () => {
    const { rows } = await db.query<{ name: string }>(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.prosecdef
          and not coalesce(p.proconfig, '{}') @> array['search_path=""']`,
    );
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it("el bucket de CV es privado y limita tamaño y tipos", async () => {
    const { rows } = await db.query<{
      public: boolean;
      file_size_limit: string;
      allowed_mime_types: string[];
    }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(false);
    expect(Number(rows[0]!.file_size_limit)).toBe(4 * 1024 * 1024);
    expect(rows[0]!.allowed_mime_types).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });
});
