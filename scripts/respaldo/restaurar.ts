/**
 * Restaura un respaldo hecho con respaldar.ts. REEMPLAZA todos los datos del
 * destino (tablas de la aplicación y de Auth) y vuelve a subir los CV.
 *
 * Antes: el destino debe tener el esquema al día con las migraciones
 * (local: `npx supabase db reset --no-seed`; nube: `npx supabase db push`).
 *
 * Uso (ver docs/respaldo-y-restauracion.md):
 *   Local: npx tsx --env-file=.env.local scripts/respaldo/restaurar.ts --desde respaldos/<fecha> --confirmar local
 *   Nube:  npx tsx --env-file=.env.produccion scripts/respaldo/restaurar.ts --desde … --db-url "postgresql://…" --confirmar <host>
 * Opciones: --workdir <carpeta con supabase/> (local). Requiere Docker (psql corre en un contenedor).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BUCKET, ROOT, fail, lastMigration, localProjectId, parseArgs, run, sha256, storageClient, type Manifest } from "./comun";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.desde !== "string") fail("Indique la carpeta del respaldo con --desde.");
  const source = path.resolve(args.desde);
  const manifestPath = path.join(source, "manifiesto.json");
  if (!existsSync(manifestPath)) fail(`No existe ${manifestPath}.`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const workdir = typeof args.workdir === "string" ? path.resolve(args.workdir) : ROOT;
  const dbUrl = typeof args["db-url"] === "string" ? args["db-url"] : null;

  // Confirmación explícita del destino: la restauración borra los datos actuales.
  const target = dbUrl ? new URL(dbUrl).hostname : "local";
  if (args.confirmar !== target) {
    fail(`La restauración REEMPLAZA los datos de «${target}». Repita el comando con --confirmar ${target}.`);
  }
  if (manifest.lastMigration !== lastMigration()) {
    console.warn(
      `⚠ El respaldo es de la migración ${manifest.lastMigration} y el repositorio está en ${lastMigration()}. ` +
        "Restaure sobre un esquema en la misma migración que el respaldo.",
    );
    if (args.forzar !== true) fail("Use --forzar si está seguro de que el esquema es compatible.");
  }

  /** psql dentro de un contenedor: el de la base local o uno temporal para una URL. */
  function psqlCommand(): { command: string; args: string[] } {
    const base = ["-v", "ON_ERROR_STOP=1", "-X", "-q"];
    if (dbUrl) return { command: "docker", args: ["run", "--rm", "-i", "postgres:17-alpine", "psql", dbUrl, ...base] };
    return {
      command: "docker",
      args: ["exec", "-i", `supabase_db_${localProjectId(workdir)}`, "psql", "-U", "postgres", "-d", "postgres", ...base],
    };
  }

  // 1. Datos: vaciar y cargar en UNA transacción (si algo falla, el destino queda como estaba).
  // Sin «restart identity»: las secuencias de Auth no son de postgres; el volcado trae sus valores (setval).
  const truncate = `
  do $$
  declare v_tables text;
  begin
    select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into v_tables
    from pg_tables
    where schemaname in ('public', 'private', 'auth')
      and not (schemaname = 'auth' and tablename = 'schema_migrations');
    execute 'truncate table ' || v_tables || ' cascade';
  end
  $$;`;
  const script = [
    "begin;",
    "set session_replication_role = replica;",
    truncate,
    readFileSync(path.join(source, "datos.sql"), "utf8"),
    "set session_replication_role = origin;",
    "commit;",
  ].join("\n");

  console.log(`→ Restaurando datos en ${target}…`);
  const psql = psqlCommand();
  run(psql.command, [...psql.args, "-o", "/dev/null"], { label: "Restauración de datos", input: script, cwd: ROOT });

  // 2. Comprobación: filas por tabla iguales a las del respaldo.
  const tables = Object.keys(manifest.tables);
  const countSql = tables
    .map((table) => {
      const [schema, name] = table.split(".");
      return `select '${table}' || '=' || count(*) from "${schema}"."${name}";`;
    })
    .join("\n");
  const counted = spawnSync(psql.command, [...psql.args, "-A", "-t"], { input: countSql, encoding: "utf8", shell: false });
  if (counted.status !== 0) fail("No se pudieron contar las filas restauradas.");
  const mismatches: string[] = [];
  for (const line of counted.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [table, value] = line.split("=");
    if (Number(value) !== manifest.tables[table!]) mismatches.push(`${table}: ${value} (respaldo: ${manifest.tables[table!]})`);
  }
  if (mismatches.length > 0) fail(`Filas distintas tras restaurar:\n  ${mismatches.join("\n  ")}`);
  console.log(`✔ Datos: ${tables.length} tablas con las mismas filas que el respaldo.`);

  // 3. Archivos: se suben de nuevo (reemplazan si existen) y se verifica su huella.
  console.log("→ Restaurando archivos de CV…");
  const bucket = storageClient();
  for (const file of manifest.files) {
    const bytes = readFileSync(path.join(source, "archivos", ...file.name.split("/")));
    if (sha256(bytes) !== file.sha256) fail(`El archivo ${file.name} del respaldo no coincide con su huella.`);
    const contentType = file.name.endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const { error } = await bucket.upload(file.name, bytes, { contentType, upsert: true });
    if (error) fail(`No se pudo subir ${file.name}: ${error.message}`);
  }
  for (const file of manifest.files) {
    const { data, error } = await bucket.download(file.name);
    if (error || !data || sha256(new Uint8Array(await data.arrayBuffer())) !== file.sha256) {
      fail(`El archivo ${file.name} no quedó igual que en el respaldo.`);
    }
  }
  console.log(`✔ Archivos: ${manifest.files.length} en el bucket «${BUCKET}», verificados por huella.`);
  console.log("✔ Restauración completa. Pruebe ingresar con un usuario del respaldo.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
