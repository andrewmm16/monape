/**
 * Demostración del robot: crea 10 vacantes FICTICIAS publicadas y las pone en
 * la cola de los 5 portales de la demo (2 por portal), para ver al robot
 * publicarlas una tras otra.
 *
 *   npm run bot:demo-queue             activa el robot en los portales extra, crea las 10 y las encola
 *   npm run bot:demo-queue -- --solo-activar  solo activa el robot en los portales extra (la vacante se crea desde la app)
 *   npm run bot:demo-queue -- --limpiar  borra las vacantes de la demostración y
 *                                        vuelve a desactivar los portales que este script activó
 *
 * Solo contra la base de datos local o de pruebas (mismas protecciones que
 * `db:seed`). Las vacantes de la demostración llevan «[DEMO ROBOT]» en la
 * descripción y «(demo)» en el título. «Trabajos Diarios» ya viene activado por
 * la migración del robot: este script nunca lo cambia. Los otros cuatro portales
 * se marcan con bot_enabled=true solo en esta base local; qué portales activó
 * queda en bot/.state/demo-portales-activados.json (ignorado por git).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

const MARKER = "[DEMO ROBOT]";
/** Portal que la migración del robot ya deja activado; la demo nunca lo modifica. */
const BASE_PORTAL = "Trabajos Diarios";
/** Los cuatro portales ficticios extra: la demo los activa y --limpiar los restaura. */
const EXTRA_PORTALS = ["LinkedIn", "Bumeran", "Indeed", "Computrabajo"];
/** Orden de reparto: la vacante i va al portal i % 5, así que 10 vacantes dan 2 por portal. */
const PORTALS = [BASE_PORTAL, ...EXTRA_PORTALS];
const ACTIVATED_FILE = path.resolve("bot/.state/demo-portales-activados.json");
const POSITIONS = [
  "Operario de almacén",
  "Cajero/a de tienda",
  "Asistente administrativo",
  "Chofer repartidor",
  "Auxiliar de limpieza",
  "Vendedor/a de tienda",
  "Técnico de mantenimiento",
  "Recepcionista",
  "Mozo/a de salón",
  "Ayudante de cocina",
];

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("Defina NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (por ejemplo en .env.local).");
if (process.env.APP_ENV === "production") fail("No se cargan datos de demostración en producción.");
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  fail("Solo se ejecuta contra la base de datos local.");
}

const supabase = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function demoVacancyIds(): Promise<string[]> {
  const { data, error } = await supabase.from("vacancies").select("id").like("description", `${MARKER}%`);
  if (error) fail(`No se pudieron leer las vacantes de la demostración: ${error.message}`);
  return (data ?? []).map((row) => row.id);
}

function readActivated(): string[] {
  try {
    const data: unknown = JSON.parse(readFileSync(ACTIVATED_FILE, "utf8"));
    return Array.isArray(data) ? data.filter((name): name is string => EXTRA_PORTALS.includes(String(name))) : [];
  } catch {
    return [];
  }
}

async function clean() {
  const ids = await demoVacancyIds();
  if (ids.length === 0) console.log("No hay vacantes de la demostración.");
  else {
    const publications = await supabase.from("portal_publications").delete().in("vacancy_id", ids);
    if (publications.error) fail(`No se pudieron borrar las publicaciones: ${publications.error.message}`);
    const vacancies = await supabase.from("vacancies").delete().in("id", ids);
    if (vacancies.error) fail(`No se pudieron borrar las vacantes: ${vacancies.error.message}`);
    console.log(`Borradas ${ids.length} vacantes de la demostración.`);
  }

  // Solo se desactivan los portales que este script activó (nunca «${BASE_PORTAL}»).
  const activated = readActivated();
  if (activated.length > 0) {
    const restored = await supabase.from("job_portals").update({ bot_enabled: false }).in("name", activated);
    if (restored.error) fail(`No se pudo desactivar el robot en los portales de la demostración: ${restored.error.message}`);
    console.log(`Robot desactivado de nuevo en: ${activated.join(", ")}.`);
  }
  rmSync(ACTIVATED_FILE, { force: true });
}

/** Lee los 5 portales y activa el robot en los extra que aún no lo tengan. */
async function activatePortals() {
  const found = await supabase.from("job_portals").select("id, name, bot_enabled").in("name", PORTALS);
  if (found.error) fail(`No se pudo leer el catálogo de portales: ${found.error.message}`);
  const portals = new Map((found.data ?? []).map((row) => [row.name, row]));
  for (const name of PORTALS) if (!portals.has(name)) fail(`No se encontró el portal «${name}» en el catálogo.`);
  if (!portals.get(BASE_PORTAL)!.bot_enabled) fail(`El portal «${BASE_PORTAL}» no tiene el robot activado (migración del robot).`);

  // Activa el robot en los portales extra que aún no lo tengan y recuerda cuáles fueron.
  const toActivate = EXTRA_PORTALS.filter((name) => !portals.get(name)!.bot_enabled);
  if (toActivate.length > 0) {
    const activated = await supabase.from("job_portals").update({ bot_enabled: true }).in("name", toActivate);
    if (activated.error) fail(`No se pudo activar el robot en los portales de la demostración: ${activated.error.message}`);
    mkdirSync(path.dirname(ACTIVATED_FILE), { recursive: true });
    writeFileSync(ACTIVATED_FILE, JSON.stringify([...new Set([...readActivated(), ...toActivate])]));
    console.log(`Robot activado (solo en esta base local) en: ${toActivate.join(", ")}.`);
  }
  return portals;
}

async function enqueue() {
  if ((await demoVacancyIds()).length > 0) fail("Ya hay vacantes de la demostración. Use --limpiar primero.");
  const portals = await activatePortals();

  for (const [index, position] of POSITIONS.entries()) {
    const portal = portals.get(PORTALS[index % PORTALS.length]!)!;
    const vacancy = await supabase
      .from("vacancies")
      .insert({
        title: `${position} (demo)`,
        department: "Demostración",
        description: `${MARKER} Oferta ficticia para ver al robot publicar. Puesto: ${position}.`,
        location: "Lima",
        city: "Lima",
        region: "Lima",
        employment_type: "tiempo_completo",
        opening_date: "2026-10-29",
        status: "publicada",
      })
      .select("id")
      .single();
    if (vacancy.error || !vacancy.data) fail(`No se pudo crear la vacante ${index + 1}: ${vacancy.error?.message}`);
    const queued = await supabase.from("portal_publications").insert({ vacancy_id: vacancy.data.id, portal_id: portal.id });
    if (queued.error) fail(`No se pudo encolar la vacante ${index + 1}: ${queued.error.message}`);
  }
  console.log(`Listo: ${POSITIONS.length} vacantes ficticias en la cola, ${POSITIONS.length / PORTALS.length} por portal (${PORTALS.join(", ")}).`);
}

const run = process.argv.includes("--limpiar")
  ? clean()
  : process.argv.includes("--solo-activar")
    ? activatePortals().then(() => console.log("Listo: cree la vacante desde la app y elija los portales."))
    : enqueue();
run.catch((error) => fail(String(error)));
