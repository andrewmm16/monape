/**
 * Genera src/types/database.ts a partir de las migraciones, sin Docker:
 * aplica las migraciones en PGlite e introspecciona el catálogo.
 *
 * El formato es compatible con `supabase gen types typescript`. Cuando exista
 * un proyecto Supabase conectado puede usarse el generador oficial:
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 *
 * Uso: npm run db:types
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createTestDatabase } from "../tests/db/harness";

type TypeInfo = { oid: number; typname: string; typtype: string; typelem: number; nspname: string };

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "src", "types", "database.ts");

const SCALARS: Record<string, string> = {
  uuid: "string",
  text: "string",
  varchar: "string",
  bpchar: "string",
  name: "string",
  date: "string",
  time: "string",
  timestamp: "string",
  timestamptz: "string",
  interval: "string",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  bool: "boolean",
  json: "Json",
  jsonb: "Json",
  void: "undefined",
};

async function main() {
  const db = await createTestDatabase();

  const types = new Map<number, TypeInfo>();
  const typeRows = await db.query<TypeInfo>(
    `select t.oid::int as oid, t.typname, t.typtype, t.typelem::int as typelem, n.nspname
       from pg_type t join pg_namespace n on n.oid = t.typnamespace`,
  );
  for (const row of typeRows.rows) types.set(row.oid, row);

  const tsType = (oid: number): string => {
    const info = types.get(oid);
    if (!info) return "unknown";
    if (info.typtype === "e") {
      return `Database["${info.nspname}"]["Enums"]["${info.typname}"]`;
    }
    if (info.typname.startsWith("_") && info.typelem) {
      return `${tsType(info.typelem)}[]`;
    }
    return SCALARS[info.typname] ?? "unknown";
  };

  // --- Enums ---------------------------------------------------------------
  const enumRows = await db.query<{ typname: string; labels: string[] }>(
    `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
       from pg_type t
       join pg_enum e on e.enumtypid = t.oid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
      group by t.typname
      order by t.typname`,
  );

  // --- Columnas de tablas y vistas -----------------------------------------
  const columnRows = await db.query<{
    relname: string;
    relkind: string;
    attname: string;
    atttypid: number;
    attnotnull: boolean;
    atthasdef: boolean;
    attgenerated: string;
    attidentity: string;
  }>(
    `select c.relname, c.relkind, a.attname, a.atttypid::int as atttypid, a.attnotnull,
            a.atthasdef, a.attgenerated, a.attidentity
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
        and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attname`,
  );

  // --- Relaciones (claves foráneas) ----------------------------------------
  const fkRows = await db.query<{
    conname: string;
    relname: string;
    columns: string[];
    referenced: string;
    referenced_columns: string[];
    one_to_one: boolean;
  }>(
    `select con.conname,
            c.relname,
            (select array_agg(a.attname order by k.ord)
               from unnest(con.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
            rc.relname as referenced,
            (select array_agg(a.attname order by k.ord)
               from unnest(con.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as referenced_columns,
            exists (
              select 1 from pg_constraint u
               where u.conrelid = con.conrelid and u.contype in ('p', 'u')
                 and (select array_agg(x order by x) from unnest(u.conkey) x)
                   = (select array_agg(x order by x) from unnest(con.conkey) x)
            ) as one_to_one
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_class rc on rc.oid = con.confrelid
       join pg_namespace rn on rn.oid = rc.relnamespace
      where con.contype = 'f' and n.nspname = 'public' and rn.nspname = 'public'
      order by c.relname, con.conname`,
  );

  // --- Funciones RPC --------------------------------------------------------
  const fnRows = await db.query<{
    proname: string;
    arg_names: string[] | null;
    arg_types: number[];
    arg_modes: string[] | null;
    nargdefaults: number;
    nargs: number;
    retset: boolean;
    rettype: number;
  }>(
    `select p.proname,
            p.proargnames as arg_names,
            coalesce(p.proallargtypes, p.proargtypes::oid[])::int[] as arg_types,
            p.proargmodes::text[] as arg_modes,
            p.pronargdefaults as nargdefaults,
            p.pronargs as nargs,
            p.proretset as retset,
            p.prorettype::int as rettype
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and p.prorettype <> 'trigger'::regtype
      order by p.proname`,
  );

  const relations = new Map<string, { kind: string; columns: typeof columnRows.rows }>();
  for (const col of columnRows.rows) {
    const rel = relations.get(col.relname) ?? { kind: col.relkind, columns: [] };
    rel.columns.push(col);
    relations.set(col.relname, rel);
  }

  const indent = (text: string, spaces: number) =>
    text
      .split("\n")
      .map((line) => (line ? " ".repeat(spaces) + line : line))
      .join("\n");

  const relationshipBlock = (relname: string) => {
    const fks = fkRows.rows.filter((fk) => fk.relname === relname);
    if (fks.length === 0) return "Relationships: []";
    const items = fks.map(
      (fk) =>
        `{\n  foreignKeyName: "${fk.conname}"\n  columns: ${JSON.stringify(fk.columns)}\n  isOneToOne: ${fk.one_to_one}\n  referencedRelation: "${fk.referenced}"\n  referencedColumns: ${JSON.stringify(fk.referenced_columns)}\n},`,
    );
    return `Relationships: [\n${indent(items.join("\n"), 2)}\n]`;
  };

  const tables: string[] = [];
  const views: string[] = [];
  for (const [relname, rel] of [...relations.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = rel.columns
      .map((c) => {
        const nullable = rel.kind === "v" || !c.attnotnull;
        return `${c.attname}: ${tsType(c.atttypid)}${nullable ? " | null" : ""}`;
      })
      .join("\n");
    if (rel.kind === "v") {
      views.push(`${relname}: {\n  Row: {\n${indent(row, 4)}\n  }\n  ${relationshipBlock(relname)}\n}`);
      continue;
    }
    const insert = rel.columns
      .map((c) => {
        const generated = c.attgenerated === "s" || c.attidentity === "a";
        if (generated) return `${c.attname}?: never`;
        const optional = !c.attnotnull || c.atthasdef || c.attidentity === "d";
        return `${c.attname}${optional ? "?" : ""}: ${tsType(c.atttypid)}${c.attnotnull ? "" : " | null"}`;
      })
      .join("\n");
    const update = rel.columns
      .map((c) => {
        const generated = c.attgenerated === "s" || c.attidentity === "a";
        if (generated) return `${c.attname}?: never`;
        return `${c.attname}?: ${tsType(c.atttypid)}${c.attnotnull ? "" : " | null"}`;
      })
      .join("\n");
    tables.push(
      `${relname}: {\n  Row: {\n${indent(row, 4)}\n  }\n  Insert: {\n${indent(insert, 4)}\n  }\n  Update: {\n${indent(update, 4)}\n  }\n${indent(relationshipBlock(relname), 2)}\n}`,
    );
  }

  const functions = fnRows.rows.map((fn) => {
    const modes = fn.arg_modes ?? fn.arg_types.map(() => "i");
    const names = fn.arg_names ?? [];
    const inputs: string[] = [];
    const outputs: string[] = [];
    const inputIndexes = modes.flatMap((m, i) => (m === "i" || m === "b" ? [i] : []));
    const firstDefault = inputIndexes.length - fn.nargdefaults;
    modes.forEach((mode, i) => {
      const name = names[i] ?? `arg${i}`;
      const type = tsType(fn.arg_types[i]!);
      if (mode === "i" || mode === "b") {
        const optional = inputIndexes.indexOf(i) >= firstDefault;
        // Los argumentos SQL aceptan NULL salvo que la función sea STRICT.
        inputs.push(`${name}${optional ? "?" : ""}: ${type} | null`);
      }
      if (mode === "t" || mode === "o" || mode === "b") outputs.push(`${name}: ${type} | null`);
    });
    const args = inputs.length ? `{\n${indent(inputs.join("\n"), 2)}\n}` : "never";
    let returns: string;
    if (outputs.length) {
      returns = `{\n${indent(outputs.join("\n"), 2)}\n}${fn.retset ? "[]" : ""}`;
    } else {
      returns = `${tsType(fn.rettype)}${fn.retset ? "[]" : ""}`;
    }
    return `${fn.proname}: {\n  Args: ${args.replace(/\n/g, "\n  ")}\n  Returns: ${returns.replace(/\n/g, "\n  ")}\n}`;
  });

  const enums = enumRows.rows.map(
    (e) => `${e.typname}: ${e.labels.map((l) => JSON.stringify(l)).join(" | ")}`,
  );
  const enumConstants = enumRows.rows.map(
    (e) => `${e.typname}: [${e.labels.map((l) => JSON.stringify(l)).join(", ")}],`,
  );

  const output = `// ARCHIVO GENERADO por scripts/gen-db-types.ts a partir de supabase/migrations.
// No editar manualmente: ejecutar \`npm run db:types\`.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13"
  }
  public: {
    Tables: {
${indent(tables.join("\n"), 6)}
    }
    Views: {
${indent(views.join("\n"), 6)}
    }
    Functions: {
${indent(functions.join("\n"), 6)}
    }
    Enums: {
${indent(enums.join("\n"), 6)}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"]
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
${indent(enumConstants.join("\n"), 6)}
    },
  },
} as const
`;

  writeFileSync(OUTPUT, output.replace(/[ \t]+$/gm, ""));
  await db.close();
  console.log(`Tipos generados en ${path.relative(ROOT, OUTPUT)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
