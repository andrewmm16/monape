/**
 * Carga DATOS FICTICIOS para desarrollo y pruebas. Nunca usar con datos reales.
 *
 *   npm run db:seed
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (clave secreta del
 * proyecto local o de pruebas). Se niega a ejecutarse contra un proyecto
 * remoto salvo SEED_ALLOW_REMOTE=true, y nunca con APP_ENV=production.
 *
 * Se ejecuta con la condición "react-server" (ver package.json) para reutilizar
 * el extractor de CV real del servidor.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "../src/types/database";
import { EXTRACTOR_VERSION, extractResume } from "../src/modules/resumes/extraction";
import { validateResumeFile } from "../src/modules/resumes/file-validation";
import { makeDocx, makeEmptyPdf, makePdf } from "../tests/fixtures/documents";

const MARKER = "[DATOS FICTICIOS]";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("Defina NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (por ejemplo en .env.local).");
if (process.env.APP_ENV === "production") fail("No se cargan datos ficticios en producción.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1"].includes(host) && process.env.SEED_ALLOW_REMOTE !== "true") {
  fail(`El proyecto ${host} no es local. Use SEED_ALLOW_REMOTE=true solo en un proyecto de pruebas.`);
}

const supabase = createClient<Database>(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const password = process.env.SEED_USER_PASSWORD || `Demo-${randomBytes(9).toString("base64url")}9`;

const USERS = [
  { email: "admin@reclutamiento.test", fullName: "Administración Ficticia", role: "admin" },
  { email: "rrhh@reclutamiento.test", fullName: "Responsable RRHH Ficticia", role: "rrhh" },
] as const;

async function ensureUser(user: (typeof USERS)[number]): Promise<string> {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listError) fail(`No se pudieron listar usuarios: ${listError.message}`);
  let id = list.users.find((u) => u.email === user.email)?.id;
  if (!id) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password,
      email_confirm: true,
      app_metadata: { role: user.role },
      user_metadata: { full_name: user.fullName },
    });
    if (error || !data.user) fail(`No se pudo crear ${user.email}: ${error?.message}`);
    id = data.user.id;
  }
  // Supabase Auth guarda app_metadata después de insertar el usuario, por lo que
  // el trigger de alta crea el perfil desactivado y sin el rol: se fijan aquí.
  const { error: roleError } = await supabase.from("profiles").update({ role: user.role, is_active: true }).eq("id", id);
  if (roleError) fail(`No se pudo asignar el rol de ${user.email}: ${roleError.message}`);
  return id;
}

async function insertOne<T extends keyof Database["public"]["Tables"]>(table: T, row: TablesInsert<T>): Promise<string> {
  const { data, error } = await supabase.from(table).insert(row as never).select("id").single();
  if (error || !data) fail(`Error al insertar en ${String(table)}: ${error?.message}`);
  return (data as unknown as { id: string }).id;
}

type RequirementSeed = Omit<TablesInsert<"vacancy_requirements">, "vacancy_id">;

async function createVacancy(
  values: Omit<TablesInsert<"vacancies">, "description"> & { description: string },
  requirements: RequirementSeed[],
  approve: boolean,
): Promise<string> {
  const id = await insertOne("vacancies", { ...values, description: `${MARKER} ${values.description}` });
  for (const [position, requirement] of requirements.entries()) {
    await insertOne("vacancy_requirements", { ...requirement, vacancy_id: id, position });
  }
  if (approve) {
    const { error } = await supabase
      .from("vacancies")
      .update({ criteria_version: 1, criteria_approved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail(`No se pudieron aprobar los criterios: ${error.message}`);
  }
  return id;
}

async function attachResume(candidateId: string, fileName: string, bytes: Uint8Array) {
  const declaredType = fileName.endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const validation = validateResumeFile({ name: fileName, size: bytes.length, declaredType, bytes });
  if (!validation.ok) fail(`CV ficticio inválido (${fileName}): ${validation.reason}`);

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
  return { resumeId, status: extraction.status };
}

async function main() {
  const { data: existing } = await supabase.from("vacancies").select("id").like("description", `${MARKER}%`).limit(1);
  if (existing?.length) fail("Los datos ficticios ya fueron cargados. Reinicie la base de datos local para repetir.");

  const [adminId, rrhhId] = await Promise.all(USERS.map(ensureUser));
  console.log("✔ Usuarios ficticios listos");

  const analyst = await createVacancy(
    {
      title: "Analista de Datos",
      department: "Tecnología",
      description: "Análisis de información comercial y elaboración de reportes para la toma de decisiones.",
      responsibilities: "Construir tableros, automatizar reportes y presentar hallazgos a las áreas usuarias.",
      location: "Lima",
      modality: "hibrido",
      contract_type: "Plazo indeterminado",
      opening_date: "2026-10-01",
      closing_date: "2026-11-30",
      owner_id: rrhhId,
      status: "publicada",
    },
    [
      { category: "formacion", priority: "obligatorio", description: "Bachiller en Ingeniería de Sistemas, Industrial, Estadística o afín", keywords: ["Ingeniería de Sistemas", "Ingeniería Industrial", "Estadística", "Ingeniería Informática"], weight: 3 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia mínima de 2 años en análisis de datos", keywords: ["análisis de datos", "analista de datos"], weight: 4, min_years: 2 },
      { category: "herramienta", priority: "obligatorio", description: "Consultas SQL", keywords: ["SQL", "SQL Server", "PostgreSQL", "MySQL"], weight: 4 },
      { category: "herramienta", priority: "deseable", description: "Power BI o Tableau", keywords: ["Power BI", "Tableau"], weight: 2 },
      { category: "habilidad_tecnica", priority: "deseable", description: "Python para análisis de datos", keywords: ["Python", "pandas"], weight: 2 },
      { category: "idioma", priority: "deseable", description: "Inglés intermedio", keywords: ["inglés"], weight: 1 },
      { category: "competencia", priority: "obligatorio", description: "Comunicación de resultados a áreas no técnicas", keywords: ["presentaciones", "comunicación"], weight: 2 },
    ],
    true,
  );

  const accountant = await createVacancy(
    {
      title: "Asistente Contable",
      department: "Finanzas",
      description: "Soporte en registro contable, planillas y obligaciones tributarias.",
      responsibilities: "Registrar operaciones, conciliar cuentas y preparar declaraciones.",
      location: "Arequipa",
      modality: "presencial",
      opening_date: "2026-10-10",
      owner_id: rrhhId,
      status: "publicada",
    },
    [
      { category: "formacion", priority: "obligatorio", description: "Técnico o bachiller en Contabilidad", keywords: ["Contabilidad", "Contador"], weight: 3 },
      { category: "certificacion", priority: "obligatorio", description: "Colegiatura vigente (CCP)", keywords: ["colegiado", "colegiatura", "CCP"], weight: 2, is_essential: true },
      { category: "herramienta", priority: "obligatorio", description: "Manejo de PLAME y PDT", keywords: ["PLAME", "PDT"], weight: 3 },
      { category: "herramienta", priority: "deseable", description: "Concar o Siscont", keywords: ["Concar", "Siscont"], weight: 2 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia mínima de 1 año en el área contable", keywords: ["contable", "contabilidad"], weight: 3, min_years: 1 },
    ],
    true,
  );

  await createVacancy(
    {
      title: "Coordinador de Proyectos",
      department: "Operaciones",
      description: "Vacante en preparación: criterios aún no aprobados.",
      responsibilities: "",
      status: "borrador",
      owner_id: adminId,
    },
    [{ category: "experiencia", priority: "obligatorio", description: "Gestión de proyectos", keywords: ["proyectos"], weight: 3 }],
    false,
  );

  console.log("✔ Vacantes y requisitos");

  const people = [
    {
      candidate: { full_name: "Lucía Ficticia Rojas", email: "lucia.ficticia@correo.test", phone: "+51 900 000 001", source: "linkedin" as const },
      vacancy: analyst,
      file: ["lucia-ficticia.pdf", await makePdf([
        "Lucía Ficticia Rojas · lucia.ficticia@correo.test · +51 900 000 001",
        "Bachiller en Ingeniería Industrial - Universidad Ficticia del Perú (2019)",
        "Analista de Datos con 4 años de experiencia en análisis de datos comerciales.",
        "Herramientas: SQL Server, Power BI, Excel avanzado y Python (pandas).",
        "Elaboración de presentaciones de resultados para gerencias comerciales.",
        "Inglés intermedio.",
      ])] as const,
    },
    {
      candidate: { full_name: "Carlos Ficticio Mendoza", email: "carlos.ficticio@correo.test", phone: null, source: "bolsa_empleo" as const },
      vacancy: analyst,
      file: ["carlos-ficticio.docx", makeDocx([
        "Técnico en Computación e Informática.",
        "Asistente de reportes durante 1 año: elaboración de reportes en Excel y Tableau.",
        "Conocimientos básicos de MySQL.",
      ], { header: "Carlos Ficticio Mendoza · carlos.ficticio@correo.test" })] as const,
    },
    {
      candidate: { full_name: "Ana Ficticia Quispe", email: "ana.ficticia@correo.test", phone: "+51 900 000 003", source: "referido" as const },
      vacancy: accountant,
      file: ["ana-ficticia.pdf", await makePdf([
        "Ana Ficticia Quispe",
        "Bachiller en Contabilidad. Contadora colegiada (CCP).",
        "3 años de experiencia contable en empresas comerciales.",
        "Declaraciones mensuales con PDT y planillas con PLAME. Sistema Concar.",
      ])] as const,
    },
    {
      candidate: { full_name: "Jorge Ficticio Salas", email: null, phone: "+51 900 000 004", source: "manual" as const },
      vacancy: accountant,
      file: ["jorge-ficticio.pdf", await makePdf(["Jorge Ficticio Salas", "Experiencia en ventas y atención al cliente.", "Disponibilidad inmediata."])] as const,
    },
    {
      candidate: { full_name: "Rosa Ficticia Torres", email: "rosa.ficticia@correo.test", phone: null, source: "web_empresa" as const },
      vacancy: analyst,
      file: ["rosa-ficticia-escaneado.pdf", await makeEmptyPdf()] as const,
    },
  ];

  for (const person of people) {
    const origins: Record<string, string> = { full_name: "declarado" };
    if (person.candidate.email) origins.email = "declarado";
    if (person.candidate.phone) origins.phone = "declarado";
    const candidateId = await insertOne("candidates", { ...person.candidate, field_origins: origins });
    const { resumeId, status } = await attachResume(candidateId, person.file[0], person.file[1]);
    await insertOne("applications", { candidate_id: candidateId, vacancy_id: person.vacancy, resume_id: resumeId });
    console.log(`✔ ${person.candidate.full_name}: CV ${person.file[0]} (${status})`);
  }

  console.log("\nDatos ficticios cargados. Usuarios:");
  for (const user of USERS) console.log(`  ${user.role.padEnd(10)} ${user.email}`);
  if (!process.env.SEED_USER_PASSWORD) {
    console.log(`  Contraseña generada (se muestra una sola vez): ${password}`);
  } else {
    console.log("  Contraseña: la definida en SEED_USER_PASSWORD (solo para usuarios creados ahora).");
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
