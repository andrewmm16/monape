/**
 * Carga DATOS FICTICIOS para desarrollo y pruebas. Nunca usar con datos reales.
 *
 *   npm run db:seed
 *
 * Crea los usuarios admin@ y rrhh@reclutamiento.test y 5 vacantes publicadas,
 * con criterios aprobados y 11 candidatos cada una (perfiles altos, medios y
 * bajos; un DOCX, un PDF escaneado sin texto y personas sin correo). Las cuatro
 * primeras quedan evaluadas con el motor de reglas; «Técnico de Soporte TI»
 * queda sin evaluar para probar «Evaluar pendientes».
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (clave secreta del
 * proyecto local o de pruebas). Se niega a ejecutarse contra un proyecto
 * remoto salvo SEED_ALLOW_REMOTE=true, y nunca con APP_ENV=production.
 *
 * Se ejecuta con la condición "react-server" (ver package.json) para reutilizar
 * el extractor de CV y el motor de evaluación reales del servidor.
 */
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "../src/types/database";
import { evaluateApplication } from "../src/modules/evaluation/service";
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

// ---------------------------------------------------------------------------
// Datos de las vacantes. Cada candidato es [portal, frases del CV]; las frases
// se toman de `lines`, de modo que cada perfil cumpla unos requisitos y otros no.
// «docx» y «escaneado» cambian el formato del archivo.
// ---------------------------------------------------------------------------

type Format = "pdf" | "docx" | "escaneado";
type CandidateSeed = [portal: string, keys: string[], format?: Format];

interface VacancySeed {
  vacancy: Omit<TablesInsert<"vacancies">, "description" | "owner_id"> & { description: string };
  requirements: RequirementSeed[];
  lines: Record<string, string>;
  candidates: CandidateSeed[];
  evaluate: boolean;
}

const VACANCIES: VacancySeed[] = [
  {
    vacancy: {
      title: "Analista de Datos",
      department: "Tecnología",
      description: "Análisis de información comercial y elaboración de reportes para la toma de decisiones.",
      responsibilities: "Construir tableros, automatizar reportes y presentar hallazgos a las áreas usuarias.",
      location: "Lima",
      modality: "hibrido",
      employment_type: "tiempo_completo",
      contract_type: "Plazo indeterminado",
      opening_date: "2026-10-01",
      closing_date: "2026-12-15",
      status: "publicada",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Bachiller en Ingeniería de Sistemas, Industrial, Estadística o afín", keywords: ["Ingeniería de Sistemas", "Ingeniería Industrial", "Estadística", "Ingeniería Informática"], weight: 3 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia mínima de 2 años en análisis de datos", keywords: ["análisis de datos", "analista de datos"], weight: 4, min_years: 2 },
      { category: "herramienta", priority: "obligatorio", description: "Consultas SQL", keywords: ["SQL", "SQL Server", "PostgreSQL", "MySQL"], weight: 4 },
      { category: "herramienta", priority: "deseable", description: "Power BI o Tableau", keywords: ["Power BI", "Tableau"], weight: 2 },
      { category: "habilidad_tecnica", priority: "deseable", description: "Python para análisis de datos", keywords: ["Python", "pandas"], weight: 2 },
      { category: "idioma", priority: "deseable", description: "Inglés intermedio", keywords: ["inglés"], weight: 1 },
      { category: "competencia", priority: "obligatorio", description: "Comunicación de resultados a áreas no técnicas", keywords: ["presentaciones", "comunicación"], weight: 2 },
    ],
    lines: {
      ind: "Bachiller en Ingeniería Industrial - Universidad Ficticia del Perú (2019).",
      est: "Licenciatura en Estadística - Universidad Ficticia Nacional (2020).",
      adm: "Bachiller en Administración de Empresas.",
      tec: "Técnico en Computación e Informática.",
      exp5: "Analista de Datos con 5 años de experiencia en análisis de datos comerciales.",
      exp3: "3 años de experiencia en análisis de datos para el área de marketing.",
      exp1: "1 año de experiencia como practicante de análisis de datos.",
      sql: "Consultas SQL en SQL Server y PostgreSQL.",
      mysql: "Conocimientos básicos de MySQL.",
      bi: "Tableros en Power BI para la gerencia comercial.",
      tableau: "Reportes semanales en Tableau.",
      py: "Python (pandas) para limpieza y modelado de datos.",
      en: "Inglés intermedio.",
      com: "Presentaciones de resultados a áreas no técnicas.",
      excel: "Excel avanzado: tablas dinámicas y macros.",
      ventas: "Experiencia en atención al cliente y ventas.",
    },
    candidates: [
      ["LinkedIn", ["ind", "exp5", "sql", "bi", "py", "en", "com"]],
      ["Computrabajo", ["est", "exp3", "sql", "tableau", "com"]],
      ["Indeed", ["ind", "exp3", "sql", "bi", "excel"]],
      ["Bumeran", ["est", "exp1", "sql", "py", "en"]],
      ["Página de empleos", ["ind", "sql", "bi", "com"]],
      ["Computrabajo", ["adm", "exp1", "excel", "tableau"]],
      ["LinkedIn", ["ind", "exp5", "mysql", "en"]],
      ["Trabajos Diarios", ["adm", "ventas"]],
      ["Get on Board", ["est", "exp3", "sql", "py", "bi", "en", "com"]],
      ["Indeed", ["tec", "exp1", "tableau", "mysql"], "docx"],
      ["Página de empleos", [], "escaneado"],
    ],
    evaluate: true,
  },
  {
    vacancy: {
      title: "Asistente Contable",
      department: "Finanzas",
      description: "Soporte en registro contable, planillas y obligaciones tributarias.",
      responsibilities: "Registrar operaciones, conciliar cuentas y preparar declaraciones.",
      location: "Arequipa",
      modality: "presencial",
      employment_type: "tiempo_completo",
      opening_date: "2026-10-10",
      closing_date: "2026-12-10",
      status: "publicada",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Técnico o bachiller en Contabilidad", keywords: ["Contabilidad", "Contador"], weight: 3 },
      { category: "certificacion", priority: "obligatorio", description: "Colegiatura vigente (CCP)", keywords: ["colegiado", "colegiatura", "CCP"], weight: 2, is_essential: true },
      { category: "herramienta", priority: "obligatorio", description: "Manejo de PLAME y PDT", keywords: ["PLAME", "PDT"], weight: 3 },
      { category: "herramienta", priority: "deseable", description: "Concar o Siscont", keywords: ["Concar", "Siscont"], weight: 2 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia mínima de 1 año en el área contable", keywords: ["contable", "contabilidad"], weight: 3, min_years: 1 },
    ],
    lines: {
      bach: "Bachiller en Contabilidad - Universidad Ficticia de Arequipa.",
      tec: "Técnico en Contabilidad - Instituto Ficticio del Sur.",
      adm: "Estudios de Administración (incompletos).",
      ccp: "Contador colegiado (CCP).",
      pdt: "Declaraciones mensuales con PDT y planillas con PLAME.",
      pdt621: "Declaraciones mensuales con PDT 621.",
      concar: "Manejo del sistema Concar.",
      siscont: "Registro de compras y ventas en Siscont.",
      exp3: "3 años de experiencia contable en empresas comerciales.",
      exp1: "1 año de experiencia en el área de contabilidad.",
      prac: "Prácticas preprofesionales de seis meses en un estudio contable.",
      ventas: "Experiencia en ventas y atención al cliente.",
      excel: "Excel intermedio.",
    },
    candidates: [
      ["Computrabajo", ["bach", "ccp", "pdt", "concar", "exp3"]],
      ["Bumeran", ["bach", "ccp", "pdt", "siscont", "exp1"]],
      ["Indeed", ["tec", "pdt", "concar", "exp3"]],
      ["LinkedIn", ["bach", "pdt621", "exp1", "excel"]],
      ["Computrabajo", ["tec", "prac", "excel"]],
      ["Página de empleos", ["bach", "ccp", "pdt", "exp3"]],
      ["Trabajos Diarios", ["adm", "ventas"]],
      ["Bumeran", ["tec", "pdt", "siscont", "exp1"]],
      ["Empleos Perú", ["bach", "ccp", "concar", "prac"]],
      ["Computrabajo", ["tec", "pdt621", "excel"]],
      ["Indeed", ["bach", "ccp", "pdt", "concar", "siscont", "exp3"]],
    ],
    evaluate: true,
  },
  {
    vacancy: {
      title: "Ejecutivo de Ventas",
      department: "Comercial",
      description: "Venta de soluciones a empresas y seguimiento de la cartera de clientes.",
      responsibilities: "Prospectar clientes, negociar propuestas y cumplir la cuota mensual.",
      location: "Lima",
      modality: "presencial",
      employment_type: "tiempo_completo",
      opening_date: "2026-10-15",
      closing_date: "2026-12-20",
      status: "publicada",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Técnico o bachiller en Administración, Marketing o Negocios", keywords: ["Administración", "Marketing", "Negocios Internacionales"], weight: 2 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia mínima de 2 años en ventas", keywords: ["ventas", "ejecutivo comercial", "asesor comercial"], weight: 4, min_years: 2 },
      { category: "herramienta", priority: "deseable", description: "Manejo de un CRM", keywords: ["CRM", "Salesforce", "HubSpot"], weight: 2 },
      { category: "competencia", priority: "obligatorio", description: "Negociación y cierre de ventas", keywords: ["negociación", "cierre de ventas"], weight: 3 },
      { category: "certificacion", priority: "deseable", description: "Licencia de conducir A-I", keywords: ["licencia de conducir", "brevete"], weight: 1 },
      { category: "idioma", priority: "deseable", description: "Inglés básico", keywords: ["inglés"], weight: 1 },
    ],
    lines: {
      adm: "Bachiller en Administración de Empresas.",
      mkt: "Técnico en Marketing - Instituto Ficticio de Lima.",
      sec: "Secundaria completa.",
      exp4: "4 años de experiencia en ventas corporativas como ejecutivo comercial.",
      exp2: "2 años de experiencia como asesor comercial en retail.",
      exp1: "1 año de experiencia en ventas por teléfono.",
      crm: "Seguimiento de clientes en Salesforce (CRM).",
      hub: "Uso de HubSpot para la prospección de clientes.",
      neg: "Negociación con clientes y cierre de ventas de alto valor.",
      lic: "Licencia de conducir A-I vigente.",
      en: "Inglés básico.",
      meta: "Cumplimiento de metas mensuales del 110 %.",
      caja: "Experiencia en caja y almacén.",
    },
    candidates: [
      ["LinkedIn", ["adm", "exp4", "crm", "neg", "lic", "en"]],
      ["Computrabajo", ["mkt", "exp2", "neg", "meta"]],
      ["Bumeran", ["adm", "exp1", "hub", "en"]],
      ["Indeed", ["sec", "exp4", "neg", "lic"]],
      ["Trabajos Diarios", ["sec", "caja"]],
      ["Computrabajo", ["mkt", "exp2", "crm", "neg", "en"]],
      ["Página de empleos", ["adm", "neg", "meta"]],
      ["Bumeran", ["mkt", "exp1", "caja"]],
      ["LinkedIn", ["adm", "exp2", "hub", "neg", "lic"]],
      ["Indeed", ["adm", "exp4", "crm", "meta", "en"]],
      ["Google", ["mkt", "exp1", "neg", "lic"]],
    ],
    evaluate: true,
  },
  {
    vacancy: {
      title: "Asistente de Recursos Humanos",
      department: "Recursos Humanos",
      description: "Apoyo en reclutamiento, selección y administración de personal.",
      responsibilities: "Publicar avisos, filtrar CV, coordinar entrevistas y apoyar en planillas.",
      location: "Lima",
      modality: "hibrido",
      employment_type: "tiempo_completo",
      opening_date: "2026-10-20",
      closing_date: "2026-12-31",
      status: "publicada",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Bachiller en Psicología, Administración o Relaciones Industriales", keywords: ["Psicología", "Administración", "Relaciones Industriales"], weight: 3 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia mínima de 1 año en reclutamiento y selección", keywords: ["selección de personal", "reclutamiento"], weight: 4, min_years: 1 },
      { category: "herramienta", priority: "obligatorio", description: "Excel intermedio", keywords: ["Excel"], weight: 2 },
      { category: "herramienta", priority: "deseable", description: "Elaboración de planillas", keywords: ["planillas", "PLAME"], weight: 2 },
      { category: "habilidad_tecnica", priority: "deseable", description: "Conocimiento de legislación laboral", keywords: ["legislación laboral", "régimen laboral"], weight: 2 },
      { category: "competencia", priority: "obligatorio", description: "Trabajo en equipo y confidencialidad", keywords: ["trabajo en equipo", "confidencialidad"], weight: 2 },
    ],
    lines: {
      psi: "Bachiller en Psicología Organizacional - Universidad Ficticia de Lima.",
      ri: "Licenciatura en Relaciones Industriales.",
      dis: "Técnico en Diseño Gráfico.",
      exp3: "3 años de experiencia en reclutamiento y selección de personal masivo.",
      exp1: "1 año de experiencia en selección de personal para retail.",
      prac: "Prácticas en el área de reclutamiento durante seis meses.",
      excel: "Excel intermedio: tablas dinámicas y BUSCARV.",
      plan: "Apoyo en la elaboración de planillas y su declaración en PLAME.",
      leg: "Conocimiento de legislación laboral peruana.",
      eq: "Trabajo en equipo y manejo de información con confidencialidad.",
      bien: "Organización de actividades de bienestar.",
      piezas: "Diseño de piezas gráficas para campañas.",
    },
    candidates: [
      ["LinkedIn", ["psi", "exp3", "excel", "plan", "leg", "eq"]],
      ["Computrabajo", ["ri", "exp1", "excel", "eq"]],
      ["Bumeran", ["psi", "prac", "excel", "bien"]],
      ["Indeed", ["ri", "exp3", "plan", "leg"]],
      ["Página de empleos", ["dis", "piezas"]],
      ["Computrabajo", ["psi", "exp1", "excel", "plan", "eq"]],
      ["LinkedIn", ["psi", "prac", "leg", "eq"]],
      ["Trabajos Diarios", ["dis", "excel", "bien"]],
      ["Bumeran", ["ri", "exp3", "excel", "plan", "leg", "eq"]],
      ["Get on Board", ["psi", "exp1", "bien"]],
      ["Empleos Perú", ["ri", "prac", "excel", "plan"]],
    ],
    evaluate: true,
  },
  {
    vacancy: {
      title: "Técnico de Soporte TI",
      department: "Tecnología",
      description: "Soporte a usuarios, equipos y red de la sede.",
      responsibilities: "Atender incidencias, administrar cuentas de usuario y mantener la red local.",
      location: "Trujillo",
      modality: "presencial",
      employment_type: "tiempo_completo",
      opening_date: "2026-10-25",
      closing_date: "2026-12-31",
      status: "publicada",
    },
    requirements: [
      { category: "formacion", priority: "obligatorio", description: "Técnico en Computación e Informática o Redes", keywords: ["Computación e Informática", "Redes y Comunicaciones", "Ingeniería de Sistemas"], weight: 3 },
      { category: "experiencia", priority: "obligatorio", description: "Experiencia mínima de 1 año en soporte técnico", keywords: ["soporte técnico", "mesa de ayuda", "help desk"], weight: 4, min_years: 1 },
      { category: "herramienta", priority: "obligatorio", description: "Windows Server y Active Directory", keywords: ["Windows Server", "Active Directory"], weight: 3 },
      { category: "certificacion", priority: "deseable", description: "Certificación ITIL o CCNA", keywords: ["ITIL", "CCNA"], weight: 2 },
      { category: "habilidad_tecnica", priority: "deseable", description: "Redes y cableado estructurado", keywords: ["TCP/IP", "cableado estructurado", "redes LAN"], weight: 2 },
      { category: "competencia", priority: "obligatorio", description: "Atención al usuario", keywords: ["atención al usuario", "servicio al cliente"], weight: 2 },
    ],
    lines: {
      tec: "Técnico en Computación e Informática - Instituto Ficticio del Norte.",
      red: "Técnico en Redes y Comunicaciones.",
      ele: "Técnico en Electricidad.",
      exp3: "3 años de experiencia en soporte técnico y mesa de ayuda.",
      exp1: "1 año de experiencia en help desk para una entidad financiera.",
      prac: "Prácticas de soporte técnico durante cuatro meses.",
      ad: "Administración de usuarios en Active Directory y Windows Server 2019.",
      itil: "Certificación ITIL Foundation.",
      ccna: "Curso CCNA 1 y 2 completo.",
      lan: "Configuración de redes LAN, TCP/IP y cableado estructurado.",
      aten: "Atención al usuario presencial y remota.",
      tab: "Mantenimiento de tableros eléctricos.",
    },
    candidates: [
      ["Computrabajo", ["tec", "exp3", "ad", "itil", "lan", "aten"]],
      ["Bumeran", ["red", "exp1", "lan", "aten"]],
      ["Indeed", ["tec", "prac", "ad", "aten"]],
      ["LinkedIn", ["red", "exp3", "ad", "ccna", "lan"]],
      ["Trabajos Diarios", ["ele", "tab"]],
      ["Computrabajo", ["tec", "exp1", "ad", "aten"]],
      ["Página de empleos", ["tec", "prac", "lan"]],
      ["Bumeran", ["red", "exp3", "itil", "aten"]],
      ["Indeed", ["ele", "exp1", "aten"]],
      ["Empleos Perú", ["tec", "ad", "lan", "aten"]],
      ["Computrabajo", ["red", "exp1", "ad", "ccna", "lan", "aten"]],
    ],
    evaluate: false,
  },
];

const FIRST_NAMES_F = ["Lucía", "Ana", "Rosa", "María", "Carmen", "Patricia", "Sofía", "Valeria", "Daniela", "Camila", "Fiorella", "Milagros", "Andrea", "Gabriela", "Paola", "Katherine", "Jimena", "Lorena", "Mariela", "Diana", "Elena", "Silvia", "Teresa", "Verónica", "Claudia", "Natalia", "Pilar", "Rocío"];
const FIRST_NAMES_M = ["Carlos", "Jorge", "Luis", "José", "Miguel", "Juan", "Pedro", "Diego", "Renzo", "Bruno", "Martín", "Ricardo", "Sergio", "Alonso", "Gonzalo", "Héctor", "Iván", "Óscar", "Raúl", "Fernando", "Víctor", "Eduardo", "Andrés", "Javier", "César", "Manuel", "Pablo"];
const SURNAMES = ["Rojas", "Mendoza", "Quispe", "Salas", "Torres", "Flores", "Huamán", "Chávez", "Ramírez", "Vargas", "Castillo", "Espinoza", "Gutiérrez", "Sánchez", "Díaz", "Cruz", "Romero", "Herrera", "Medina", "Aguilar", "Ríos", "Paredes", "Vásquez", "Ccori", "Mamani", "Cárdenas", "Palacios", "Benites", "Núñez", "Zapata", "Silva", "Rivera", "Campos", "Navarro", "Arias", "Cabrera", "Ortiz", "Delgado", "Fernández", "Montoya", "Soto", "Valdivia", "Lozano", "Peña", "Reyes", "Acosta", "Guerrero", "Salazar", "Bravo", "Carrasco", "Molina", "Ponce", "Tapia", "Villanueva", "Zevallos"];

/** Persona ficticia número `n`: alterna mujeres y hombres; cada 9.ª no tiene correo y cada 4.ª no tiene teléfono. */
function fictitiousPerson(n: number) {
  const female = n % 2 === 0;
  const first = female ? FIRST_NAMES_F[n / 2] : FIRST_NAMES_M[(n - 1) / 2];
  const surname = SURNAMES[n];
  if (!first || !surname) fail(`Faltan nombres ficticios para la persona ${n + 1}.`);
  const slug = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return {
    full_name: `${first} ${female ? "Ficticia" : "Ficticio"} ${surname}`,
    email: n % 9 === 6 ? null : `${slug(first)}.${slug(surname)}@correo.test`,
    phone: n % 4 === 3 ? null : `+51 900 ${String(100 + n).padStart(3, "0")} ${String(200 + n * 7).slice(-3)}`,
    fileBase: `${slug(first)}-${slug(surname)}`,
  };
}

async function main() {
  const { data: existing } = await supabase.from("vacancies").select("id").like("description", `${MARKER}%`).limit(1);
  if (existing?.length) fail("Los datos ficticios ya fueron cargados. Reinicie la base de datos local para repetir.");

  const [adminId, rrhhId] = await Promise.all(USERS.map(ensureUser));
  console.log("✔ Usuarios ficticios listos");

  const { data: portals, error: portalsError } = await supabase.from("job_portals").select("id, name, candidate_source");
  if (portalsError || !portals) fail(`No se pudo leer el catálogo de portales: ${portalsError?.message}`);

  let n = 0;
  for (const [index, seed] of VACANCIES.entries()) {
    const vacancyId = await createVacancy({ ...seed.vacancy, owner_id: index === 4 ? adminId : rrhhId }, seed.requirements, true);
    let evaluated = 0;
    let pending = 0;

    for (const [portalName, keys, format = "pdf"] of seed.candidates) {
      const portal = portals.find((p) => p.name === portalName);
      if (!portal) fail(`El portal «${portalName}» no está en el catálogo.`);
      const person = fictitiousPerson(n++);
      const contact = [person.full_name, person.email, person.phone].filter(Boolean).join(" · ");
      const body = keys.map((key) => {
        const line = seed.lines[key];
        if (!line) fail(`Falta la frase «${key}» en ${seed.vacancy.title}.`);
        return line;
      });

      let file: [string, Uint8Array];
      if (format === "docx") file = [`${person.fileBase}.docx`, makeDocx(body, { header: contact })];
      else if (format === "escaneado") file = [`${person.fileBase}-escaneado.pdf`, await makeEmptyPdf()];
      else file = [`${person.fileBase}.pdf`, await makePdf([contact, ...body])];

      const origins: Record<string, string> = { full_name: "declarado" };
      if (person.email) origins.email = "declarado";
      if (person.phone) origins.phone = "declarado";
      const candidateId = await insertOne("candidates", {
        full_name: person.full_name,
        email: person.email,
        phone: person.phone,
        source: portal.candidate_source,
        field_origins: origins,
      });
      const { resumeId } = await attachResume(candidateId, file[0], file[1]);
      const applicationId = await insertOne("applications", {
        candidate_id: candidateId,
        vacancy_id: vacancyId,
        resume_id: resumeId,
        portal_id: portal.id,
      });

      if (seed.evaluate) {
        try {
          await evaluateApplication(supabase, applicationId, "reglas", { system: true });
          evaluated++;
        } catch {
          pending++; // CV sin texto: queda para «Leer escaneo» o la transcripción de RRHH.
        }
      } else {
        pending++;
      }
    }
    console.log(`✔ ${seed.vacancy.title}: ${seed.candidates.length} candidatos (${evaluated} evaluados, ${pending} sin evaluar)`);
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
