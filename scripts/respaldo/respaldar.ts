/**
 * Respaldo completo: datos de la base (todas las tablas de la aplicación y de
 * Auth) + archivos de CV del bucket + manifiesto con conteos y huellas.
 * El ESQUEMA no se respalda: son las migraciones del repositorio.
 *
 * Uso (ver docs/respaldo-y-restauracion.md):
 *   Local:  npx tsx --env-file=.env.local scripts/respaldo/respaldar.ts
 *   Nube:   npx tsx --env-file=.env.produccion scripts/respaldo/respaldar.ts --db-url "postgresql://…"
 * Opciones: --destino <carpeta> (por defecto respaldos/<fecha>), --workdir <carpeta con supabase/>.
 * Requiere Docker (la CLI de Supabase corre pg_dump en un contenedor).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  EXCLUDED_TABLES,
  ROOT,
  countCopyRows,
  fail,
  lastMigration,
  listAllFiles,
  parseArgs,
  run,
  sha256,
  storageClient,
  type Manifest,
} from "./comun";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const destination = path.resolve(typeof args.destino === "string" ? args.destino : path.join(ROOT, "respaldos", stamp));
  const workdir = typeof args.workdir === "string" ? path.resolve(args.workdir) : ROOT;
  const dbUrl = typeof args["db-url"] === "string" ? args["db-url"] : null;

  mkdirSync(path.join(destination, "archivos"), { recursive: true });
  const dataFile = path.join(destination, "datos.sql");

  console.log(`→ Respaldando datos de ${dbUrl ? "la base indicada" : "la base local"}…`);
  run(
    "npx",
    [
      "supabase",
      "db",
      "dump",
      "--data-only",
      "--use-copy",
      ...(dbUrl ? [`--remote=${dbUrl}`] : ["--workdir", workdir]),
      ...EXCLUDED_TABLES.flatMap((table) => ["-x", table]),
      "-f",
      dataFile,
    ],
    { label: "Volcado de datos", cwd: ROOT },
  );
  const tables = countCopyRows(readFileSync(dataFile, "utf8"));
  if (!tables["public.candidates"] && tables["public.candidates"] !== 0) fail("El volcado no incluye public.candidates: revise la conexión.");

  console.log("→ Respaldando archivos de CV…");
  const bucket = storageClient();
  const names = await listAllFiles(bucket);
  const files: Manifest["files"] = [];
  for (const name of names) {
    const { data, error } = await bucket.download(name);
    if (error || !data) fail(`No se pudo descargar ${name}: ${error?.message ?? "sin datos"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    const target = path.join(destination, "archivos", ...name.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
  }

  const manifest: Manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    lastMigration: lastMigration(),
    source: dbUrl ? "remota" : `local (${path.relative(ROOT, workdir) || "."})`,
    tables,
    files,
  };
  writeFileSync(path.join(destination, "manifiesto.json"), JSON.stringify(manifest, null, 2));

  const rows = Object.values(tables).reduce((sum, n) => sum + n, 0);
  console.log(`✔ Respaldo en ${destination}`);
  console.log(`  ${Object.keys(tables).length} tablas · ${rows} filas · ${files.length} archivos · migración ${manifest.lastMigration}`);
  console.log("  Contiene datos personales: guárdelo cifrado y fuera del repositorio.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
