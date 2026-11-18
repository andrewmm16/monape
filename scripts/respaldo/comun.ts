/**
 * Utilidades comunes de los scripts de respaldo y restauración
 * (ver docs/respaldo-y-restauracion.md).
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const BUCKET = "resumes";

/** Tablas que no van en el volcado de datos: Storage se respalda aparte (archivos + su API). */
export const EXCLUDED_TABLES = [
  "storage.buckets",
  "storage.buckets_analytics",
  "storage.buckets_vectors",
  "storage.bucket_lifecycle_states",
  "storage.iceberg_namespaces",
  "storage.iceberg_tables",
  "storage.lifecycle_abandoned_artifacts",
  "storage.objects",
  "storage.s3_multipart_uploads",
  "storage.s3_multipart_uploads_parts",
  "storage.vector_indexes",
];

export type Manifest = {
  version: 1;
  createdAt: string;
  /** Última migración del repositorio al respaldar: el destino debe tener el mismo esquema. */
  lastMigration: string;
  source: string;
  tables: Record<string, number>;
  files: { name: string; bytes: number; sha256: string }[];
};

export function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    const key = eq === -1 ? body : body.slice(0, eq);
    if (eq !== -1) args[key] = body.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) args[key] = argv[++i]!;
    else args[key] = true;
  }
  return args;
}

export function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** Ejecuta un comando y corta el script si falla. Nunca imprime los argumentos (pueden llevar la URL con contraseña). */
export function run(command: string, args: string[], options: SpawnSyncOptions & { label: string }): void {
  const quoted = args.map((arg) => (/[\s"&|<>^%!]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg));
  // Una sola cadena con shell (npx es un .cmd en Windows); los argumentos ya van entre comillas.
  const result = spawnSync([command, ...quoted].join(" "), { stdio: ["pipe", "inherit", "inherit"], shell: true, ...options });
  if (result.status !== 0) fail(`${options.label}: terminó con código ${result.status ?? "desconocido"}.`);
}

export function lastMigration(): string {
  const dir = path.join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return files.at(-1) ?? "ninguna";
}

/** Id del proyecto local (nombre del contenedor supabase_db_<id>) según el config.toml del workdir. */
export function localProjectId(workdir: string): string {
  const config = readFileSync(path.join(workdir, "supabase", "config.toml"), "utf8");
  const match = /^project_id\s*=\s*"([^"]+)"/m.exec(config);
  if (!match) fail(`No se encontró project_id en ${workdir}/supabase/config.toml.`);
  return match[1]!;
}

/** Filas por tabla según los bloques COPY del volcado (`COPY "esquema"."tabla" (...) FROM stdin;` … `\.`). */
export function countCopyRows(sql: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let current: string | null = null;
  for (const line of sql.split("\n")) {
    if (current) {
      if (line === "\\." || line === "\\.\r") current = null;
      else counts[current] = (counts[current] ?? 0) + 1;
      continue;
    }
    const match = /^COPY "([^"]+)"\."([^"]+)"/.exec(line);
    if (match) {
      current = `${match[1]}.${match[2]}`;
      counts[current] = counts[current] ?? 0;
    }
  }
  return counts;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Cliente de servicio de Supabase para los archivos (variables del entorno indicado con --env-file). */
export function storageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (use --env-file con el entorno del proyecto).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(BUCKET);
}

/** Todos los archivos del bucket (recorre las carpetas). */
export async function listAllFiles(bucket: ReturnType<typeof storageClient>, prefix = ""): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) fail(`No se pudo listar el bucket (${prefix || "/"}): ${error.message}`);
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Las carpetas no tienen id.
      if (entry.id === null) names.push(...(await listAllFiles(bucket, full)));
      else names.push(full);
    }
    if (data.length < 1000) break;
  }
  return names;
}
