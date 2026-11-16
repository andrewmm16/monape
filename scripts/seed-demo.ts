/**
 * Datos de DEMOSTRACIÓN para el entorno LOCAL. Todo es ficticio.
 *
 *   npx tsx --conditions=react-server --env-file-if-exists=.env.local scripts/seed-demo.ts
 *
 * - Borra las vacantes de demostración anteriores (marcadas con [DEMO]) y sus datos.
 *   Con DEMO_BORRAR_TODO=true borra TODAS las vacantes (y los candidatos que queden
 *   solo asociados a ellas). Nunca toca usuarios ni perfiles.
 * - Crea 2 vacantes publicadas con criterios aprobados y preguntas eliminatorias.
 * - Escribe 4 CV por puesto en cv-prueba/ y carga 3 de cada puesto (el 4.º queda
 *   solo como archivo para demostrar la subida en vivo).
 *
 * Solo local: se niega a ejecutarse contra un proyecto remoto o con APP_ENV=production.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "../src/types/database";
import { evaluateApplication } from "../src/modules/evaluation/service";
import { EXTRACTOR_VERSION, extractResume } from "../src/modules/resumes/extraction";
import { validateResumeFile } from "../src/modules/resumes/file-validation";
import { makePdf } from "../tests/fixtures/documents";

const MARKER = "[DEMO]";
const OUT_DIR = path.resolve(process.cwd(), "cv-prueba");

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("Defina NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (por ejemplo en .env.local).");
if (process.env.APP_ENV === "production") fail("No se cargan datos de demostración en producción.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1"].includes(host)) fail(`El proyecto ${host} no es local. Este seed solo corre en local.`);

const supabase = createClient<Database>(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function insertOne<T extends keyof Database["public"]["Tables"]>(table: T, row: TablesInsert<T>): Promise<string> {
  const { data, error } = await supabase.from(table).insert(row as never).select("id").single();
  if (error || !data) fail(`Error al insertar en ${String(table)}: ${error?.message}`);
  return (data as unknown as { id: string }).id;
}

// ---------------------------------------------------------------------------
// Borrado seguro
// ---------------------------------------------------------------------------

async function wipe(all: boolean) {
  let query = supabase.from("vacancies").select("id, title, status");
  if (!all) query = query.like("description", `${MARKER}%`);
  const { data: vacancies, error } = await query;
  if (error) fail(`No se pudieron leer las vacantes: ${error.message}`);
  if (!vacancies?.length) {
    console.log("• No hay vacantes que borrar.");
    return 0;
  }
  console.log(`Vacantes a borrar (${vacancies.length}):`);
  for (const v of vacancies) console.log(`  - ${v.title} [${v.status}]`);
  const vacancyIds = vacancies.map((v) => v.id);

  // Candidatos cuyas postulaciones están SOLO en estas vacantes.
  const { data: apps } = await supabase.from("applications").select("candidate_id, vacancy_id").in("vacancy_id", vacancyIds);
  const candidateIds = [...new Set((apps ?? []).map((a) => a.candidate_id))];
  const exclusive: string[] = [];
  for (const candidateId of candidateIds) {
    const { count } = await supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", candidateId)
      .not("vacancy_id", "in", `(${vacancyIds.join(",")})`);
    if (!count) exclusive.push(candidateId);
  }

  // Archivos de Storage de esos candidatos.
  if (exclusive.length) {
    const { data: resumes } = await supabase.from("resumes").select("storage_path").in("candidate_id", exclusive);
    const paths = (resumes ?? []).map((r) => r.storage_path);
    if (paths.length) {
      const { error: rmError } = await supabase.storage.from("resumes").remove(paths);
      if (rmError) console.warn(`  (aviso) No se pudieron borrar algunos archivos: ${rmError.message}`);
    }
  }

  // FKs «restrict» hacia vacantes: lotes de carga y publicaciones en portales.
  for (const table of ["intake_batches", "portal_publications"] as const) {
    const { error: e } = await supabase.from(table).delete().in("vacancy_id", vacancyIds);
    if (e) fail(`No se pudo limpiar ${table}: ${e.message}`);
  }
  // Postulaciones (cascade: evaluaciones, respuestas killer, eventos, entrevistas...).
  const { error: appsError } = await supabase.from("applications").delete().in("vacancy_id", vacancyIds);
  if (appsError) fail(`No se pudieron borrar postulaciones: ${appsError.message}`);
  // Candidatos exclusivos (cascade: CV, extracciones, consentimientos).
  if (exclusive.length) {
    const { error: candError } = await supabase.from("candidates").delete().in("id", exclusive);
    if (candError) fail(`No se pudieron borrar candidatos: ${candError.message}`);
  }
  // Vacantes (cascade: requisitos, killer questions, prospectos Caleta).
  const { error: vacError } = await supabase.from("vacancies").delete().in("id", vacancyIds);
  if (vacError) fail(`No se pudieron borrar vacantes: ${vacError.message}`);
  console.log(`✔ Borradas ${vacancies.length} vacantes, ${exclusive.length} candidatos exclusivos.`);
  return vacancies.length;
}

// ---------------------------------------------------------------------------
// Definición de las vacantes
// ---------------------------------------------------------------------------

type RequirementSeed = Omit<TablesInsert<"vacancy_requirements">, "vacancy_id">;
type KillerSeed = Omit<TablesInsert<"vacancy_killer_questions">, "vacancy_id" | "position">;
type Answer = boolean | number | string;

interface CvSeed {
  level: "alto" | "medio" | "bajo" | "falla_killer";
  file: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  portal: string;
  lines: string[];
  answers: Answer[]; // en el orden de las killer questions
  load: boolean;
}

interface VacancySeed {
  folder: string;
  vacancy: Omit<TablesInsert<"vacancies">, "owner_id" | "description"> & { description: string };
  requirements: RequirementSeed[];
  killers: KillerSeed[];
  cvs: CvSeed[];
}

const VACANCIES: VacancySeed[] = [
  {
    folder: "01_Desarrollador_Full_Stack",
    vacancy: {
      title: "Desarrollador Full Stack",
      department: "Tecnología",
      description: "Desarrollo de aplicaciones web de punta a punta para los productos internos de la empresa.",
      responsibilities: "Construir interfaces en React, APIs y consultas a base de datos; participar en revisiones de código.",
      location: "Lima",
      modality: "hibrido",
      employment_type: "tiempo_completo",
      opening_date: "2026-11-01",
      closing_date: "2027-01-31",
      status: "publicada",
    },
    requirements: [
      { category: "herramienta", priority: "obligatorio", description: "React", keywords: ["react", "reactjs"], weight: 9 },
      { category: "habilidad_tecnica", priority: "obligatorio", description: "Node.js o Laravel/PHP", keywords: ["node", "nodejs", "laravel", "php", "express"], weight: 8 },
      { category: "habilidad_tecnica", priority: "obligatorio", description: "Bases de datos SQL", keywords: ["sql", "postgresql", "mysql", "base de datos"], weight: 7 },
      { category: "herramienta", priority: "deseable", description: "TypeScript", keywords: ["typescript", "ts"], weight: 5 },
      { category: "herramienta", priority: "deseable", description: "Git", keywords: ["git", "github", "gitlab"], weight: 4 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia en desarrollo web", keywords: ["desarrollo web", "full stack", "frontend", "backend"], weight: 6, min_years: 2 },
    ],
    killers: [
      { question: "¿Resides en Lima o puedes trasladarte?", question_type: "si_no", expected_boolean: true },
      { question: "¿Cuántos años de experiencia en desarrollo web tienes?", question_type: "numero", comparator: "mayor_igual", threshold: 2 },
      { question: "¿Tienes disponibilidad para modalidad híbrida?", question_type: "si_no", expected_boolean: true },
    ],
    cvs: [
      {
        level: "alto", file: "01_alto_Diego_Quispe_Ramos.pdf", name: "Diego Quispe Ramos", email: "diego.quispe.demo@example.com",
        phone: "+51 987 111 201", location: "Lima, Perú", portal: "LinkedIn", answers: [true, 5, true], load: true,
        lines: [
          "Diego Quispe Ramos", "diego.quispe.demo@example.com · +51 987 111 201 · Lima, Perú", "",
          "PERFIL", "Desarrollador Full Stack con 5 años de experiencia en desarrollo web, frontend y backend.", "",
          "EXPERIENCIA",
          "Desarrollador Full Stack - Soluciones Andinas SAC (2021 - 2026)",
          "- Interfaces con React y TypeScript para un portal de clientes.",
          "- APIs con Node.js y Express; consultas y modelado en PostgreSQL.",
          "- Control de versiones con Git y GitHub, revisiones de código.",
          "Desarrollador Web - Agencia Digital Pacífico (2020 - 2021)",
          "- Sitios con React y bases de datos MySQL.", "",
          "FORMACIÓN", "Bachiller en Ingeniería de Sistemas - Universidad Ficticia del Perú (2019).", "",
          "HABILIDADES", "React, Node.js, TypeScript, SQL, PostgreSQL, Git, Docker.",
        ],
      },
      {
        level: "medio", file: "02_medio_Rosa_Mendoza_Salas.pdf", name: "Rosa Mendoza Salas", email: "rosa.mendoza.demo@example.com",
        phone: "+51 987 111 202", location: "Lima, Perú", portal: "Computrabajo", answers: [true, 2, true], load: true,
        lines: [
          "Rosa Mendoza Salas", "rosa.mendoza.demo@example.com · +51 987 111 202 · Lima, Perú", "",
          "PERFIL", "Desarrolladora web con 2 años de experiencia en frontend.", "",
          "EXPERIENCIA",
          "Desarrolladora Frontend - Estudio Creativo Lima (2024 - 2026)",
          "- Desarrollo web de sitios institucionales con React.",
          "- Consumo de APIs REST y manejo de Git.", "",
          "FORMACIÓN", "Técnico en Computación e Informática - Instituto Ficticio de Lima (2023).", "",
          "HABILIDADES", "React, JavaScript, HTML, CSS, Git. Nociones básicas de bases de datos.",
        ],
      },
      {
        level: "bajo", file: "03_bajo_Jorge_Torres_Flores.pdf", name: "Jorge Torres Flores", email: "jorge.torres.demo@example.com",
        phone: "+51 987 111 203", location: "Lima, Perú", portal: "Bumeran", answers: [true, 0, true], load: true,
        lines: [
          "Jorge Torres Flores", "jorge.torres.demo@example.com · +51 987 111 203 · Lima, Perú", "",
          "PERFIL", "Asistente administrativo con interés en pasar al área de tecnología.", "",
          "EXPERIENCIA",
          "Asistente Administrativo - Comercial Torres (2022 - 2026)",
          "- Atención al cliente, archivo y control de inventarios en Excel.", "",
          "FORMACIÓN", "Estudios incompletos de Administración. Curso básico de HTML (2025).", "",
          "HABILIDADES", "Excel, Word, atención al cliente.",
        ],
      },
      {
        level: "falla_killer", file: "04_falla_killer_Camila_Huaman_Chavez.pdf", name: "Camila Huamán Chávez", email: "camila.huaman.demo@example.com",
        phone: "+51 987 111 204", location: "Arequipa, Perú", portal: "Get on Board", answers: [false, 4, false], load: false,
        lines: [
          "Camila Huamán Chávez", "camila.huaman.demo@example.com · +51 987 111 204 · Arequipa, Perú", "",
          "PERFIL", "Desarrolladora Full Stack con 4 años de experiencia en desarrollo web. Trabajo remoto desde Arequipa.", "",
          "EXPERIENCIA",
          "Desarrolladora Full Stack - Nube Sur (2022 - 2026)",
          "- Frontend con React y TypeScript; backend con Node.js y Laravel.",
          "- Bases de datos SQL en PostgreSQL y MySQL.",
          "- Flujo de trabajo con Git y GitLab.", "",
          "FORMACIÓN", "Bachiller en Ingeniería de Software - Universidad Ficticia de Arequipa (2021).", "",
          "DISPONIBILIDAD", "Solo trabajo remoto; sin posibilidad de traslado a Lima.",
        ],
      },
    ],
  },
  {
    folder: "02_Asistente_RRHH",
    vacancy: {
      title: "Asistente de Recursos Humanos",
      department: "Recursos Humanos",
      description: "Apoyo en planillas, reclutamiento y administración de personal.",
      responsibilities: "Elaborar planillas, filtrar CV, coordinar entrevistas y mantener los legajos del personal.",
      location: "Lima",
      modality: "presencial",
      employment_type: "tiempo_completo",
      opening_date: "2026-11-01",
      closing_date: "2027-01-31",
      status: "publicada",
    },
    requirements: [
      { category: "habilidad_tecnica", priority: "obligatorio", description: "Gestión de planillas", keywords: ["planillas", "nómina", "remuneraciones"], weight: 8 },
      { category: "herramienta", priority: "obligatorio", description: "Excel avanzado", keywords: ["excel", "hojas de cálculo", "tablas dinámicas"], weight: 7 },
      { category: "habilidad_tecnica", priority: "deseable", description: "Reclutamiento y selección", keywords: ["reclutamiento", "selección", "entrevistas"], weight: 6 },
      { category: "habilidad_tecnica", priority: "deseable", description: "Legislación laboral peruana", keywords: ["legislación laboral", "sunafil", "contratos"], weight: 5 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia en RRHH", keywords: ["recursos humanos", "rrhh", "personal"], weight: 6, min_years: 1 },
    ],
    killers: [
      { question: "¿Tienes experiencia elaborando planillas?", question_type: "si_no", expected_boolean: true },
      { question: "¿Cuál es tu nivel de Excel?", question_type: "opcion_unica", options: ["Básico", "Intermedio", "Avanzado"], accepted_options: ["Intermedio", "Avanzado"] },
      { question: "¿Cuántos años de experiencia en RRHH tienes?", question_type: "numero", comparator: "mayor_igual", threshold: 1 },
    ],
    cvs: [
      {
        level: "alto", file: "01_alto_Lucia_Vargas_Castillo.pdf", name: "Lucía Vargas Castillo", email: "lucia.vargas.demo@example.com",
        phone: "+51 987 222 301", location: "Lima, Perú", portal: "LinkedIn", answers: [true, "Avanzado", 4], load: true,
        lines: [
          "Lucía Vargas Castillo", "lucia.vargas.demo@example.com · +51 987 222 301 · Lima, Perú", "",
          "PERFIL", "Asistente de Recursos Humanos con 4 años de experiencia en RRHH y administración de personal.", "",
          "EXPERIENCIA",
          "Asistente de RRHH - Corporación Andina SAC (2022 - 2026)",
          "- Elaboración de planillas y remuneraciones mensuales (PLAME).",
          "- Excel avanzado: tablas dinámicas, BUSCARV y hojas de cálculo de nómina.",
          "- Reclutamiento y selección: publicación de avisos y entrevistas.",
          "- Contratos de trabajo y conocimiento de legislación laboral peruana; atención a fiscalizaciones de SUNAFIL.", "",
          "FORMACIÓN", "Bachiller en Administración - Universidad Ficticia de Lima (2021).",
        ],
      },
      {
        level: "medio", file: "02_medio_Martin_Salazar_Rios.pdf", name: "Martín Salazar Ríos", email: "martin.salazar.demo@example.com",
        phone: "+51 987 222 302", location: "Lima, Perú", portal: "Computrabajo", answers: [false, "Intermedio", 1], load: true,
        lines: [
          "Martín Salazar Ríos", "martin.salazar.demo@example.com · +51 987 222 302 · Lima, Perú", "",
          "PERFIL", "Asistente de personal con 1 año de experiencia en recursos humanos.", "",
          "EXPERIENCIA",
          "Auxiliar de RRHH - Distribuidora Norte (2025 - 2026)",
          "- Apoyo en reclutamiento y selección: coordinación de entrevistas.",
          "- Control de asistencia y legajos del personal.",
          "- Excel intermedio para reportes.", "",
          "FORMACIÓN", "Técnico en Gestión de Recursos Humanos - Instituto Ficticio del Centro (2024).",
        ],
      },
      {
        level: "bajo", file: "03_bajo_Pablo_Aguilar_Medina.pdf", name: "Pablo Aguilar Medina", email: "pablo.aguilar.demo@example.com",
        phone: "+51 987 222 303", location: "Lima, Perú", portal: "Indeed", answers: [false, "Básico", 0], load: true,
        lines: [
          "Pablo Aguilar Medina", "pablo.aguilar.demo@example.com · +51 987 222 303 · Lima, Perú", "",
          "PERFIL", "Vendedor de tienda en busca de una oportunidad administrativa.", "",
          "EXPERIENCIA",
          "Vendedor - Tiendas Medina (2021 - 2026)",
          "- Atención al público, caja y reposición de mercadería.", "",
          "FORMACIÓN", "Secundaria completa. Curso de Word básico.",
        ],
      },
      {
        level: "falla_killer", file: "04_falla_killer_Andrea_Cardenas_Ponce.pdf", name: "Andrea Cárdenas Ponce", email: "andrea.cardenas.demo@example.com",
        phone: "+51 987 222 304", location: "Lima, Perú", portal: "Bumeran", answers: [true, "Básico", 3], load: false,
        lines: [
          "Andrea Cárdenas Ponce", "andrea.cardenas.demo@example.com · +51 987 222 304 · Lima, Perú", "",
          "PERFIL", "Analista de RRHH con 3 años de experiencia en planillas y selección de personal.", "",
          "EXPERIENCIA",
          "Analista de RRHH - Servicios Integrales Ponce (2023 - 2026)",
          "- Elaboración de planillas y remuneraciones, contratos y legislación laboral.",
          "- Reclutamiento y selección con entrevistas por competencias.",
          "- Manejo de Excel a nivel básico para listados.", "",
          "FORMACIÓN", "Bachiller en Psicología - Universidad Ficticia Nacional (2022).",
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

async function createVacancy(seed: VacancySeed, ownerId: string): Promise<{ id: string; questionIds: string[] }> {
  const id = await insertOne("vacancies", { ...seed.vacancy, description: `${MARKER} ${seed.vacancy.description}`, owner_id: ownerId });
  for (const [position, requirement] of seed.requirements.entries()) {
    await insertOne("vacancy_requirements", { ...requirement, vacancy_id: id, position });
  }
  const questionIds: string[] = [];
  for (const [position, killer] of seed.killers.entries()) {
    questionIds.push(await insertOne("vacancy_killer_questions", { ...killer, vacancy_id: id, position }));
  }
  // Aprobación de criterios (mismo método que seed-dev: sin sesión no hay auth.uid()
  // para approve_vacancy_criteria). Debe ir DESPUÉS de insertar los requisitos.
  const { error } = await supabase
    .from("vacancies")
    .update({ criteria_version: 1, criteria_approved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail(`No se pudieron aprobar los criterios: ${error.message}`);
  return { id, questionIds };
}

async function attachResume(candidateId: string, fileName: string, bytes: Uint8Array) {
  const validation = validateResumeFile({ name: fileName, size: bytes.length, declaredType: "application/pdf", bytes });
  if (!validation.ok) fail(`CV inválido (${fileName}): ${validation.reason}`);
  const resumeId = randomUUID();
  const storagePath = `candidates/${candidateId}/${resumeId}.${validation.kind}`;
  const { error: uploadError } = await supabase.storage
    .from("resumes")
    .upload(storagePath, bytes, { contentType: validation.mimeType, upsert: false });
  if (uploadError) fail(`No se pudo subir ${fileName}: ${uploadError.message}`);
  await insertOne("resumes", {
    id: resumeId,
    candidate_id: candidateId,
    storage_path: storagePath,
    original_filename: validation.safeName,
    mime_type: validation.mimeType,
    size_bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const extraction = await extractResume(bytes, validation.kind);
  await insertOne("resume_extractions", {
    resume_id: resumeId,
    status: extraction.status,
    method: extraction.method,
    extractor_version: EXTRACTOR_VERSION,
    raw_text: extraction.text,
    suggested_fields: extraction.suggestions,
    warnings: extraction.warnings,
    error_code: extraction.errorCode,
  });
  return resumeId;
}

async function main() {
  await wipe(process.env.DEMO_BORRAR_TODO === "true");

  // Responsable: el primer usuario RRHH activo (si no, admin). No se crean ni modifican usuarios.
  const { data: owners } = await supabase.from("profiles").select("id, email, role").eq("is_active", true).in("role", ["rrhh", "admin"]);
  const owner = owners?.find((p) => p.role === "rrhh") ?? owners?.[0];
  if (!owner) fail("No hay usuarios RRHH/admin activos. Cree uno antes (npm run db:seed).");

  const { data: portals, error: portalsError } = await supabase.from("job_portals").select("id, name, candidate_source");
  if (portalsError || !portals) fail(`No se pudo leer el catálogo de portales: ${portalsError?.message}`);

  const summary: string[] = [];
  for (const seed of VACANCIES) {
    const { id: vacancyId, questionIds } = await createVacancy(seed, owner.id);
    const dir = path.join(OUT_DIR, seed.folder);
    mkdirSync(dir, { recursive: true });

    for (const cv of seed.cvs) {
      const bytes = await makePdf(cv.lines);
      writeFileSync(path.join(dir, cv.file), bytes);
      if (!cv.load) {
        summary.push(`${seed.vacancy.title} | ${cv.level} | ${cv.name} | SIN CARGAR (${cv.file})`);
        continue;
      }
      const portal = portals.find((p) => p.name === cv.portal) ?? portals[0];
      if (!portal) fail("El catálogo de portales está vacío.");
      const candidateId = await insertOne("candidates", {
        full_name: cv.name,
        email: cv.email,
        phone: cv.phone,
        location: cv.location,
        source: portal.candidate_source,
        field_origins: { full_name: "declarado", email: "declarado", phone: "declarado", location: "declarado" },
      });
      const resumeId = await attachResume(candidateId, cv.file, bytes);
      const applicationId = await insertOne("applications", {
        candidate_id: candidateId,
        vacancy_id: vacancyId,
        resume_id: resumeId,
        portal_id: portal.id,
      });

      // Respuestas a las preguntas eliminatorias (el trigger calcula `meets`).
      let fails = 0;
      for (const [i, answer] of cv.answers.entries()) {
        const questionId = questionIds[i];
        const killer = seed.killers[i];
        if (!questionId || !killer) fail("Respuesta sin pregunta asociada.");
        const row: TablesInsert<"application_killer_answers"> = {
          application_id: applicationId,
          question_id: questionId,
          meets: false, // lo recalcula el trigger
        };
        if (killer.question_type === "si_no") row.answer_boolean = answer as boolean;
        else if (killer.question_type === "numero") row.answer_number = answer as number;
        else row.answer_text = answer as string;
        const { data, error } = await supabase.from("application_killer_answers").insert(row).select("meets").single();
        if (error || !data) fail(`No se pudo guardar la respuesta killer: ${error?.message}`);
        if (!data.meets) fails++;
      }

      await evaluateApplication(supabase, applicationId, "reglas", { system: true });
      const { data: evaluation } = await supabase
        .from("candidate_evaluations")
        .select("level, score")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      summary.push(
        `${seed.vacancy.title} | ${cv.level} | ${cv.name} | evaluado: nivel=${evaluation?.level} puntaje=${evaluation?.score} | killer incumplidas=${fails}`,
      );
    }
    console.log(`✔ ${seed.vacancy.title}: vacante publicada, ${seed.requirements.length} requisitos, ${seed.killers.length} preguntas`);
  }

  console.log("\nResumen:");
  for (const line of summary) console.log(`  ${line}`);
  console.log(`\nPDF en ${OUT_DIR}`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
