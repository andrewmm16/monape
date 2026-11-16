/**
 * Crea las 3 vacantes de ingeniería del Reclutador Caleta con sus requisitos
 * ponderados y los criterios aprobados, listas para puntuar prospectos.
 *
 *   npm run db:seed:caleta
 *
 * A diferencia de db:seed, estos son DATOS REALES (no ficticios): no llevan
 * marcador y el script es idempotente (omite una vacante si ya existe otra con
 * el mismo título). No crea candidatos ni postulaciones.
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (clave secreta). Por
 * seguridad se niega a correr contra un proyecto remoto salvo SEED_ALLOW_REMOTE=true,
 * y nunca con APP_ENV=production.
 *
 * Los requisitos usan términos (keywords) que el motor de reglas busca en el
 * texto del perfil. Nota: el motor solo comprueba el MÍNIMO de años (min_years);
 * el tope del rango (p. ej. "hasta 4 años" del puesto junior) lo valora RRHH.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "../src/types/database";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("Defina NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (por ejemplo en .env.local).");
if (process.env.APP_ENV === "production") fail("No se cargan datos de prueba en producción.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1"].includes(host) && process.env.SEED_ALLOW_REMOTE !== "true") {
  fail(`El proyecto ${host} no es local. Use SEED_ALLOW_REMOTE=true solo si de verdad quiere escribir ahí.`);
}

const supabase = createClient<Database>(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type RequirementSeed = Omit<TablesInsert<"vacancy_requirements">, "vacancy_id" | "position">;

interface VacancySeed {
  vacancy: Omit<TablesInsert<"vacancies">, "owner_id">;
  requirements: RequirementSeed[];
}

const VACANCIES: VacancySeed[] = [
  {
    vacancy: {
      title: "Ingeniero Civil (Junior)",
      department: "Ingeniería",
      description:
        "Ingeniero/a civil joven para diseño estructural y/o supervisión de obra. Sueldo referencial S/ 4000-5000, negociable según años de experiencia.",
      responsibilities:
        "Apoyar en el diseño y cálculo estructural, revisar planos y participar en la supervisión de obra.",
      location: "Lima",
      modality: "presencial",
      employment_type: "tiempo_completo",
      status: "borrador",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Bachiller o titulado en Ingeniería Civil", keywords: ["Ingeniería Civil", "Ingeniero Civil", "Ing. Civil"], weight: 3 },
      { category: "experiencia", priority: "obligatorio", description: "1 a 4 años en diseño estructural y/o supervisión de obra", keywords: ["diseño estructural", "cálculo estructural", "supervisión de obra", "estructuras"], weight: 4, min_years: 1 },
      { category: "herramienta", priority: "obligatorio", description: "Manejo de AutoCAD", keywords: ["AutoCAD"], weight: 3 },
      { category: "herramienta", priority: "deseable", description: "Revit", keywords: ["Revit"], weight: 2 },
      { category: "herramienta", priority: "deseable", description: "ETABS o SAP2000", keywords: ["ETABS", "SAP2000", "SAP 2000"], weight: 2 },
      { category: "herramienta", priority: "deseable", description: "S10 (costos y presupuestos)", keywords: ["S10"], weight: 1 },
    ],
  },
  {
    vacancy: {
      title: "Ingeniero Sanitario",
      department: "Ingeniería",
      description:
        "Ingeniero/a sanitario para diseño y/o supervisión de instalaciones sanitarias. Sueldo referencial S/ 6000-7000.",
      responsibilities:
        "Diseñar y supervisar instalaciones de agua, desagüe, agua contra incendio (ACI) y cisternas; gestionar trámites ante SEDAPAL.",
      location: "Lima",
      modality: "presencial",
      employment_type: "tiempo_completo",
      status: "borrador",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Bachiller o titulado en Ingeniería Sanitaria", keywords: ["Ingeniería Sanitaria", "Ingeniero Sanitario", "Ing. Sanitario"], weight: 3 },
      { category: "experiencia", priority: "obligatorio", description: "2 a 5 años en diseño y/o supervisión de instalaciones sanitarias", keywords: ["instalaciones sanitarias", "diseño sanitario", "supervisión", "sanitarias"], weight: 4, min_years: 2 },
      { category: "habilidad_tecnica", priority: "obligatorio", description: "Agua, desagüe, agua contra incendio (ACI) y cisternas", keywords: ["agua contra incendio", "ACI", "desagüe", "cisterna", "redes de agua"], weight: 3 },
      { category: "herramienta", priority: "obligatorio", description: "Manejo de AutoCAD", keywords: ["AutoCAD"], weight: 3 },
      { category: "herramienta", priority: "deseable", description: "Revit MEP", keywords: ["Revit MEP", "Revit"], weight: 2 },
      { category: "otro", priority: "deseable", description: "Trámites ante SEDAPAL", keywords: ["SEDAPAL"], weight: 2 },
    ],
  },
  {
    vacancy: {
      title: "Ingeniero Electromecánico",
      department: "Ingeniería",
      description:
        "Ingeniero/a electromecánico o mecánico-electricista para diseño y/o supervisión de instalaciones eléctricas y mecánicas. Sueldo referencial S/ 6000-7000.",
      responsibilities:
        "Diseñar y supervisar instalaciones eléctricas (media y baja tensión, subestaciones, tableros) y mecánicas (ventilación); gestionar trámites ante Luz del Sur / Pluz.",
      location: "Lima",
      modality: "presencial",
      employment_type: "tiempo_completo",
      status: "borrador",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Bachiller o titulado en Ingeniería Electromecánica o Mecánica Eléctrica", keywords: ["Electromecánico", "Electromecánica", "Mecánico Electricista", "Mecánica Eléctrica"], weight: 3 },
      { category: "experiencia", priority: "obligatorio", description: "2 a 5 años en diseño y/o supervisión de instalaciones eléctricas y mecánicas", keywords: ["instalaciones eléctricas", "instalaciones mecánicas", "diseño eléctrico", "supervisión"], weight: 4, min_years: 2 },
      { category: "habilidad_tecnica", priority: "obligatorio", description: "Media/baja tensión, subestaciones, tableros y ventilación", keywords: ["media tensión", "baja tensión", "subestaciones", "tableros eléctricos", "ventilación"], weight: 3 },
      { category: "herramienta", priority: "obligatorio", description: "Manejo de AutoCAD", keywords: ["AutoCAD"], weight: 3 },
      { category: "herramienta", priority: "deseable", description: "Revit MEP", keywords: ["Revit MEP", "Revit"], weight: 2 },
      { category: "herramienta", priority: "deseable", description: "DIALux", keywords: ["DIALux"], weight: 2 },
      { category: "otro", priority: "deseable", description: "Trámites ante Luz del Sur / Pluz", keywords: ["Luz del Sur", "Pluz", "Enel"], weight: 1 },
    ],
  },
];

async function insertOne<T extends keyof Database["public"]["Tables"]>(table: T, row: TablesInsert<T>): Promise<string> {
  const { data, error } = await supabase.from(table).insert(row as never).select("id").single();
  if (error || !data) fail(`Error al insertar en ${String(table)}: ${error?.message}`);
  return (data as unknown as { id: string }).id;
}

async function main() {
  // Dueño: el primer usuario de personal activo, si existe (owner_id es nullable).
  const { data: owner } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["admin", "rrhh"])
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  const ownerId = owner?.id ?? null;

  for (const seed of VACANCIES) {
    const { data: existing, error: existingError } = await supabase
      .from("vacancies")
      .select("id")
      .eq("title", seed.vacancy.title)
      .limit(1)
      .maybeSingle();
    if (existingError) fail(`No se pudo comprobar la vacante «${seed.vacancy.title}»: ${existingError.message}`);
    if (existing) {
      console.log(`• «${seed.vacancy.title}» ya existe (${existing.id}); se omite.`);
      continue;
    }

    const vacancyId = await insertOne("vacancies", { ...seed.vacancy, owner_id: ownerId });
    for (const [position, requirement] of seed.requirements.entries()) {
      await insertOne("vacancy_requirements", { ...requirement, vacancy_id: vacancyId, position });
    }
    // Aprobar criterios directamente (clave de servicio, sin JWT). Deja la
    // vacante lista también para la evaluación formal del flujo normal.
    const { error: approveError } = await supabase
      .from("vacancies")
      .update({ criteria_version: 1, criteria_approved_at: new Date().toISOString() })
      .eq("id", vacancyId);
    if (approveError) fail(`No se pudieron aprobar los criterios de «${seed.vacancy.title}»: ${approveError.message}`);

    console.log(`✔ «${seed.vacancy.title}» creada (${vacancyId}) con ${seed.requirements.length} requisitos y criterios aprobados.`);
  }

  console.log("\nVacantes del Reclutador Caleta listas. Quedan en estado «borrador»; publícalas cuando quieras.");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
