/**
 * Genera material de DEMOSTRACIÓN para crear vacantes a mano y probar la carga
 * masiva de CV y el motor de afinidad. Todo es ficticio.
 *
 *   npx tsx --conditions=react-server --env-file-if-exists=.env.local scripts/generar-demo-puestos.ts
 *
 * Produce, dentro de cv-prueba/demo/ :
 *   - PUESTOS.txt          → fichas completas de los 2 puestos (para copiar y
 *                            pegar al crear la vacante manualmente).
 *   - <puesto>/*.pdf       → 20 CVs por puesto, realistas y afinados a sus
 *                            criterios (perfil, 2-3 experiencias con logros,
 *                            formación, cursos, habilidades, idiomas).
 *
 * NO toca la base de datos: solo genera archivos y verifica, con el MISMO motor
 * de evaluación del servidor, el ranking que saldría en la app.
 *
 * Control de palabras clave: el relleno realista NO introduce términos de otros
 * requisitos; los términos de cada criterio solo aparecen cuando el CV debe
 * acreditarlos, para que el ranking conserve niveles reales.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { assembleEvaluation } from "../src/modules/evaluation/assemble";
import { evaluateWithRules, RULE_ENGINE_VERSION } from "../src/modules/evaluation/rule-engine";
import type { RequirementInput } from "../src/modules/evaluation/types";
import { extractResume } from "../src/modules/resumes/extraction";
import {
  EMPLOYMENT_TYPE_LABELS,
  KILLER_QUESTION_TYPE_LABELS,
  REQUIREMENT_CATEGORY_LABELS,
  REQUIREMENT_PRIORITY_LABELS,
  WORK_MODALITY_LABELS,
} from "../src/lib/labels";
import type { Enums } from "../src/types/database";

const CV_POR_PUESTO = 20;
const ROOT = path.resolve(process.cwd(), "cv-prueba", "demo");

// --- RNG determinista ---------------------------------------------------------
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 0x100000000);
}
const rng = makeRng(20261113);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
const chance = (p: number) => rng() < p;
const rint = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const sample = <T>(arr: T[], n: number): T[] => {
  const copy = [...arr];
  for (let k = copy.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [copy[k], copy[j]] = [copy[j]!, copy[k]!]; }
  return copy.slice(0, Math.min(n, copy.length));
};
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "");

// --- Datos ficticios ----------------------------------------------------------
const FIRST_F = ["María", "Lucía", "Rosa", "Carmen", "Andrea", "Patricia", "Daniela", "Milagros", "Valeria", "Gabriela", "Fiorella", "Claudia", "Jimena", "Paola", "Sofía", "Katherine", "Diana", "Elena", "Natalia", "Yésica"];
const FIRST_M = ["Juan", "Carlos", "Luis", "Jorge", "Diego", "Martín", "Pablo", "César", "Hugo", "Sebastián", "Fernando", "Ricardo", "Walter", "Óscar", "Marco", "Renzo", "Bruno", "Gonzalo", "Álvaro", "Kevin", "Brayan", "Josué", "Iván", "Christian", "Piero"];
const LAST = ["Quispe", "Mendoza", "Torres", "Huamán", "Vargas", "Salazar", "Aguilar", "Cárdenas", "Flores", "Ramos", "Castillo", "Rojas", "Ríos", "Medina", "Chávez", "Ponce", "Soto", "Vilca", "Mamani", "Córdova", "Paredes", "Zegarra", "Espinoza", "Gutiérrez", "Navarro", "Ortiz", "Fuentes", "Bustamante", "Reyes", "Palacios", "Cueva", "Linares", "Barrios", "Aliaga", "Cornejo", "Delgado", "Peña", "Loayza", "Ayala", "Tello", "Cáceres", "Ticona", "Marín", "Lazo", "Rivera", "Campos", "Vega", "Zavala", "Luna", "Prado"];
const DISTRITOS = ["San Juan de Lurigancho", "Los Olivos", "San Martín de Porres", "Comas", "Villa El Salvador", "Ate", "Surco", "Miraflores", "Jesús María", "Breña", "Magdalena", "San Miguel", "La Molina", "Chorrillos", "Independencia"];

interface Identity { nombre: string; apellido: string; correo: string; telefono: string; ciudad: string; linkedin: string }
function identity(i: number, city: string): Identity {
  const nombre = pick(chance(0.5) ? FIRST_F : FIRST_M);
  const apellido = `${pick(LAST)} ${pick(LAST)}`;
  const n1 = sinTildes(nombre.split(" ")[0]!).toLowerCase();
  const a1 = sinTildes(apellido.split(" ")[0]!).toLowerCase();
  return {
    nombre,
    apellido,
    correo: `${n1}.${a1}${i}@example.com`,
    telefono: `+51 9${rint(10, 99)} ${rint(100, 999)} ${rint(100, 999)}`,
    ciudad: `${pick(DISTRITOS)}, ${city}`,
    linkedin: `linkedin.com/in/${n1}-${a1}${i}`,
  };
}

interface Exp { cargo: string; empresa: string; periodo: string; sector: string; logros: string[] }
interface Cv {
  titular: string;
  disponibilidad: string;
  perfil: string;
  exp: Exp[];
  formacion: string[];
  cursos: string[];
  habilidades: string[];
  competencias: string[];
  idiomas: string[];
}
type Tier = "alta" | "parcial_alta" | "parcial" | "baja" | "off";

const yearRange = (years: number, offsetEnd = 0) => {
  const end = 2026 - offsetEnd;
  const start = end - Math.max(1, years);
  return offsetEnd === 0 ? `${start} - Actualidad` : `Ene ${start} - Dic ${end}`;
};
const idiomas = () => {
  const ing = pick(["Inglés básico (A2)", "Inglés intermedio (B1)", "Inglés intermedio (B2)", "Inglés avanzado (C1) - lectura técnica"]);
  return chance(0.25) ? ["Español nativo", ing, "Quechua básico"] : ["Español nativo", ing];
};
const COMPETENCIAS = ["Trabajo en equipo", "Comunicación efectiva", "Resolución de problemas", "Proactividad", "Aprendizaje continuo", "Orientación a resultados", "Pensamiento analítico", "Organización y planificación", "Adaptabilidad", "Atención al detalle", "Responsabilidad", "Manejo del tiempo"];

// ====================== PUESTO 1: Desarrollador Full Stack ====================
const DEV_COMPANIES: [string, string][] = [
  ["Soluciones Andinas SAC", "fintech"], ["Agencia Digital Pacífico", "agencia digital"], ["Quipu Tech EIRL", "software a medida"],
  ["Nube Sur SAC", "SaaS"], ["Inka Software", "retail"], ["Yachay Labs", "edtech"], ["Pixel Perú", "e-commerce"],
  ["DataWasi SAC", "analítica"], ["Runa Digital", "logística"], ["Condor Systems", "banca"], ["Amauta Dev", "salud"], ["Tawa Solutions", "seguros"],
];
// Tareas realistas SIN palabras clave de ningún requisito (relleno neutro).
const DEV_NEUTRAL = [
  "Maquetación responsive con HTML5, CSS3 y Tailwind para distintos dispositivos.",
  "Participación en ceremonias ágiles (Scrum): dailies, planning y retrospectivas.",
  "Estimación de tareas y seguimiento del tablero en Jira.",
  "Integración y consumo de APIs REST de servicios internos y de terceros.",
  "Elaboración de documentación técnica y manuales para el equipo.",
  "Atención y resolución de incidencias reportadas por los usuarios.",
  "Colaboración con el equipo de diseño (Figma) para implementar las interfaces.",
  "Pruebas de endpoints con Postman antes de cada despliegue.",
  "Revisión de calidad y pruebas manuales previas a producción.",
  "Soporte a usuarios internos y capacitación sobre las nuevas funcionalidades.",
];
const DEV_EDU = [
  "Ingeniería de Sistemas - Universidad Ficticia del Perú", "Ingeniería de Software - Universidad Ficticia de Lima",
  "Computación e Informática - Instituto Ficticio Tecnológico", "Ingeniería Informática - Universidad Ficticia del Sur",
  "Ciencias de la Computación - Universidad Ficticia Nacional",
];
const DEV_CURSOS_NEUTRAL = ["Scrum Fundamentals (ficticio, 2024)", "Inglés técnico - Instituto Ficticio", "Clean Code y buenas prácticas (online, 2023)", "Metodologías Ágiles (2022)", "Diseño de interfaces UX/UI (2023)", "Pruebas de software (online, 2024)"];

function devCargo(react: boolean, backend: unknown, sql: unknown): string {
  if (react && (backend || sql)) return pick(["Desarrollador Full Stack", "Ingeniero de Software Full Stack", "Programador Full Stack"]);
  if (react) return pick(["Desarrollador Frontend", "Programador Frontend", "Desarrollador Web Frontend"]);
  return pick(["Desarrollador Web", "Programador Web"]);
}

function devCv(o: { years: number | null; react: boolean; backend: "Node.js" | "Laravel" | null; sql: "PostgreSQL" | "MySQL" | null; ts: boolean; git: "GitHub" | "GitLab" | null }): Cv {
  const kw: string[] = []; // bullets con palabras clave, repartibles en la experiencia
  if (o.react) kw.push(`Desarrollo de interfaces con React (componentes reutilizables, hooks) reduciendo el tiempo de carga en ${rint(20, 50)}%.`);
  if (o.backend === "Node.js") kw.push(`Construcción de APIs REST con Node.js y Express para el módulo de ${pick(["clientes", "pagos", "reportes", "pedidos"])}.`);
  if (o.backend === "Laravel") kw.push(`Desarrollo de módulos backend con Laravel y PHP (MVC, Eloquent) para la plataforma interna.`);
  if (o.sql) kw.push(`Modelado de datos y optimización de consultas en ${o.sql} (SQL); mejora de consultas lentas en un ${rint(30, 60)}%.`);
  if (o.ts) kw.push(`Migración progresiva del frontend a TypeScript para mayor robustez del código.`);
  if (o.git) kw.push(`Control de versiones con Git y flujo de trabajo en ${o.git} (ramas, pull requests y code review).`);

  const cargo = devCargo(o.react, o.backend, o.sql);
  const totalYears = o.years ?? 1;
  const exp: Exp[] = [];
  // Experiencia principal: casi todos los bullets con keyword + relleno neutro.
  exp.push({
    cargo, empresa: pick(DEV_COMPANIES)[0], sector: "", periodo: yearRange(Math.min(totalYears, 5)),
    logros: [...kw.slice(0, 4), ...sample(DEV_NEUTRAL, kw.length >= 3 ? 2 : 3)],
  });
  // Segunda experiencia para los de más trayectoria.
  if (totalYears >= 3) {
    const [emp, sec] = pick(DEV_COMPANIES);
    exp.push({
      cargo: pick(["Desarrollador Web", "Programador Junior", "Practicante de Desarrollo"]), empresa: emp, sector: sec,
      periodo: yearRange(2, Math.min(totalYears, 5)),
      logros: [...(o.react ? ["Maquetación de vistas y componentes con React."] : []), ...kw.slice(4), ...sample(DEV_NEUTRAL, 3)].slice(0, 4),
    });
  }

  const hab: string[] = [];
  if (o.react) hab.push("React", "React Hooks");
  if (o.ts) hab.push("TypeScript");
  hab.push("JavaScript", "HTML5", "CSS3", "Tailwind CSS");
  if (o.backend === "Node.js") hab.push("Node.js", "Express");
  if (o.backend === "Laravel") hab.push("Laravel", "PHP");
  if (o.sql) hab.push(o.sql, "SQL", "Modelado de datos");
  if (o.git) hab.push("Git", o.git);
  hab.push("REST", "Scrum", "Jira", "Figma");

  const cursos = sample(DEV_CURSOS_NEUTRAL, rint(2, 3));
  if (o.sql && chance(0.6)) cursos.push("Bases de datos SQL - Instituto Ficticio (2023)");
  if (o.git && chance(0.5)) cursos.push("Git y GitHub para equipos (online, 2024)");

  const extra = o.react && o.backend ? ", especializado en frontend y backend" : o.react ? " con foco en frontend" : "";
  const dbPhrase = o.sql ? " y bases de datos relacionales" : "";
  const perfil = o.years
    ? `${cargo} con ${o.years} años de experiencia en desarrollo web${extra}. Experiencia construyendo aplicaciones web escalables${dbPhrase}, trabajo en equipos ágiles (Scrum) y entrega de productos orientados al usuario. Busco seguir creciendo en proyectos retadores.`
    : `Desarrollador(a) web en formación con proyectos personales y prácticas en desarrollo web. Conocimientos de maquetación, consumo de APIs y ganas de crecer en un equipo técnico.`;

  return {
    titular: cargo,
    disponibilidad: pick(["Inmediata", "A 15 días", "Inmediata (tiempo completo)"]),
    perfil, exp,
    formacion: [`${pick(DEV_EDU)} (${2026 - totalYears - rint(1, 3)} - ${2026 - rint(0, 2)})${chance(0.5) ? ", titulado" : ", bachiller"}`],
    cursos, habilidades: hab, competencias: sample(COMPETENCIAS, 5), idiomas: idiomas(),
  };
}

// CVs de otro rubro (quedan al fondo del ranking). Dominio puro, sin keywords técnicas.
const DEV_OFF: Cv[] = [
  {
    titular: "Asistente Contable", disponibilidad: "Inmediata",
    perfil: "Asistente contable con 4 años de experiencia en contabilidad general, conciliaciones bancarias y declaraciones tributarias. Manejo de Concar y trabajo bajo plazos de cierre mensual.",
    exp: [
      { cargo: "Asistente Contable", empresa: "Distribuidora Ficticia SAC", sector: "comercial", periodo: yearRange(4), logros: ["Registro contable de más de 800 comprobantes mensuales en Concar.", "Conciliaciones bancarias de 5 cuentas con diferencias menores al 0.5%.", "Apoyo en declaraciones de IGV y renta ante SUNAT sin observaciones.", "Elaboración de reportes de gastos para gerencia."] },
      { cargo: "Auxiliar Contable", empresa: "Estudio Contable Ficticio", sector: "servicios", periodo: yearRange(2, 4), logros: ["Archivo y digitalización de documentación contable.", "Apoyo en libros electrónicos (PLE)."] },
    ],
    formacion: ["Contabilidad - Instituto Ficticio Superior (2016 - 2020), técnico"], cursos: ["Tributación empresarial (2022)", "Concar nivel intermedio"], habilidades: ["Contabilidad general", "Concar", "Conciliaciones bancarias", "Tributación (IGV, renta)", "Ofimática"], competencias: ["Orden", "Responsabilidad", "Atención al detalle", "Trabajo bajo presión"], idiomas: ["Español nativo", "Inglés básico (A2)"],
  },
  {
    titular: "Ejecutivo Comercial", disponibilidad: "A 15 días",
    perfil: "Ejecutivo comercial con 5 años en ventas B2B y manejo de cartera de clientes. Cumplimiento sostenido de metas y experiencia en negociación con cuentas clave.",
    exp: [
      { cargo: "Ejecutivo Comercial", empresa: "Comercial Ficticia EIRL", sector: "industrial", periodo: yearRange(5), logros: ["Superé la meta anual de ventas en 115% durante tres años.", "Capté 30 clientes nuevos del sector construcción.", "Gestioné una cartera de 50 cuentas en CRM.", "Elaboré propuestas comerciales y cotizaciones."] },
      { cargo: "Asesor de Ventas", empresa: "Maquinarias Ficticias SAC", sector: "retail", periodo: yearRange(2, 5), logros: ["Atención y fidelización de clientes en tienda.", "Cumplimiento de cuotas mensuales."] },
    ],
    formacion: ["Administración de Empresas - Universidad Ficticia (2013 - 2017)"], cursos: ["Ventas consultivas (2021)", "Técnicas de negociación"], habilidades: ["Ventas B2B", "Negociación", "CRM (HubSpot)", "Prospección", "Atención al cliente"], competencias: ["Comunicación", "Orientación a resultados", "Persuasión", "Resiliencia"], idiomas: ["Español nativo", "Inglés intermedio (B1)"],
  },
  {
    titular: "Diseñadora Gráfica", disponibilidad: "Inmediata",
    perfil: "Diseñadora gráfica con 4 años creando piezas para redes sociales, branding y material impreso. Manejo de la suite de Adobe y sensibilidad visual.",
    exp: [
      { cargo: "Diseñadora Gráfica", empresa: "Estudio Creativo Ficticio", sector: "publicidad", periodo: yearRange(4), logros: ["Diseño de más de 300 piezas para redes sociales.", "Desarrollo de identidad visual para 6 marcas.", "Edición de fotografía de producto.", "Coordinación con clientes sobre conceptos creativos."] },
      { cargo: "Community Manager", empresa: "Agencia Ficticia de Marketing", sector: "marketing", periodo: yearRange(2, 4), logros: ["Administración de redes de 5 cuentas.", "Elaboración de parrillas de contenido."] },
    ],
    formacion: ["Diseño Gráfico - Instituto Ficticio de Artes (2017 - 2020)"], cursos: ["Branding (2022)", "Motion graphics básico"], habilidades: ["Photoshop", "Illustrator", "InDesign", "Canva", "Community management"], competencias: ["Creatividad", "Atención al detalle", "Comunicación visual"], idiomas: ["Español nativo", "Inglés básico (A2)"],
  },
  {
    titular: "Técnico en Enfermería", disponibilidad: "Inmediata",
    perfil: "Técnico en enfermería con 6 años de experiencia en atención de pacientes en hospitalización y consulta externa. Trato cálido y trabajo en turnos rotativos.",
    exp: [
      { cargo: "Técnico en Enfermería", empresa: "Clínica Ficticia San Gabriel", sector: "salud", periodo: yearRange(6), logros: ["Toma de funciones vitales de hasta 30 pacientes por turno.", "Apoyo en procedimientos de enfermería y curaciones.", "Preparación de material estéril.", "Registro en la hoja de control del paciente."] },
      { cargo: "Técnico Asistencial", empresa: "Policlínico Ficticio", sector: "salud", periodo: yearRange(2, 6), logros: ["Apoyo en campañas de vacunación.", "Atención en triaje."] },
    ],
    formacion: ["Técnico en Enfermería - Instituto Ficticio de Salud (2015 - 2017)"], cursos: ["Soporte vital básico (RCP, 2023)", "Bioseguridad"], habilidades: ["Primeros auxilios", "Toma de funciones vitales", "Atención al paciente", "Bioseguridad"], competencias: ["Empatía", "Trabajo en equipo", "Responsabilidad"], idiomas: ["Español nativo"],
  },
];

function devFor(tier: Tier, i: number): Cv {
  switch (tier) {
    case "alta": return devCv({ years: rint(3, 8), react: true, backend: chance(0.6) ? "Node.js" : "Laravel", sql: chance(0.6) ? "PostgreSQL" : "MySQL", ts: chance(0.8), git: chance(0.9) ? "GitHub" : "GitLab" });
    case "parcial_alta": return chance(0.5)
      ? devCv({ years: 1, react: true, backend: "Node.js", sql: "PostgreSQL", ts: false, git: chance(0.5) ? "GitHub" : null })
      : devCv({ years: rint(2, 4), react: true, backend: chance(0.5) ? "Node.js" : "Laravel", sql: null, ts: false, git: null });
    case "parcial": return chance(0.5)
      ? devCv({ years: rint(2, 3), react: true, backend: null, sql: "MySQL", ts: false, git: chance(0.5) ? "GitHub" : null })
      : devCv({ years: rint(2, 3), react: true, backend: chance(0.5) ? "Node.js" : "Laravel", sql: null, ts: false, git: null });
    case "baja": return devCv({ years: 1, react: true, backend: null, sql: null, ts: chance(0.4), git: chance(0.4) ? "GitHub" : null });
    case "off": return DEV_OFF[i % DEV_OFF.length]!;
  }
}

// ====================== PUESTO 2: Asistente de RRHH ===========================
const RRHH_COMPANIES: [string, string][] = [
  ["Corporación Andina SAC", "600 trabajadores"], ["Distribuidora Norte EIRL", "180 trabajadores"], ["Textiles Ficticios del Perú SAC", "400 operarios"],
  ["Servicios Integrales Ficticios SA", "250 trabajadores"], ["Agroindustrial Ficticia SAC", "500 trabajadores"], ["Retail Ficticio Perú SAC", "320 trabajadores"],
];
const RRHH_NEUTRAL = [
  "Coordinación de la inducción y el onboarding de los nuevos ingresos.",
  "Gestión del clima laboral y organización de actividades de bienestar.",
  "Organización de capacitaciones internas y control de asistencia a las mismas.",
  "Mantenimiento de los legajos físicos y digitales del personal.",
  "Coordinación de exámenes médicos ocupacionales y entrega de EPP.",
  "Apoyo en el proceso de evaluación de desempeño semestral.",
  "Atención de consultas del personal sobre vacaciones y descansos médicos.",
  "Elaboración de reportes de asistencia, tardanzas y horas extra.",
];
const RRHH_EDU = ["Administración - Universidad Ficticia de Lima", "Gestión de Recursos Humanos - Instituto Ficticio Superior", "Relaciones Industriales - Universidad Ficticia Nacional", "Psicología Organizacional - Universidad Ficticia del Sur"];
const RRHH_CURSOS_NEUTRAL = ["Gestión del Talento Humano (2023)", "Clima y Cultura Organizacional (2022)", "Inglés básico - Instituto Ficticio", "Comunicación interna (2024)", "Ofimática aplicada a RRHH"];

function rrhhCv(o: { years: number | null; planillas: boolean; excel: "avanzado" | "intermedio" | "básico" | null; reclut: boolean; legislacion: boolean }): Cv {
  const kw: string[] = [];
  if (o.planillas) kw.push(`Elaboración de planillas y remuneraciones mensuales (PLAME) de ${rint(120, 500)} trabajadores, sin observaciones.`);
  if (o.planillas) kw.push(`Cálculo de nómina, CTS, gratificaciones y aportes (AFP/ONP) conforme a la normativa.`);
  if (o.excel === "avanzado") kw.push("Automatización de cuadros de nómina en Excel avanzado (tablas dinámicas, BUSCARV y macros), ahorrando 2 días por cierre.");
  else if (o.excel === "intermedio") kw.push("Elaboración de reportes del área en Excel a nivel intermedio.");
  else if (o.excel === "básico") kw.push("Uso de Excel básico para listados del personal.");
  if (o.reclut) kw.push("Reclutamiento y selección de personal: filtro de CV, entrevistas por competencias y coordinación con las áreas solicitantes.");
  if (o.legislacion) kw.push("Elaboración de contratos y aplicación de la legislación laboral peruana; atención a fiscalizaciones de SUNAFIL.");

  const cargo = o.planillas ? pick(["Analista de Planillas", "Analista de Planillas y RRHH", "Asistente de Planillas"]) : pick(["Asistente de Recursos Humanos", "Auxiliar de RRHH", "Asistente de Personal"]);
  const totalYears = o.years ?? 1;
  const [emp, size] = pick(RRHH_COMPANIES);
  const exp: Exp[] = [{
    cargo, empresa: emp, sector: size, periodo: yearRange(Math.min(totalYears, 5)),
    logros: [...kw, ...sample(RRHH_NEUTRAL, Math.max(2, 4 - kw.length))].slice(0, 5),
  }];
  if (totalYears >= 3) {
    const [emp2, size2] = pick(RRHH_COMPANIES);
    exp.push({ cargo: pick(["Auxiliar de RRHH", "Practicante de Recursos Humanos", "Asistente Administrativo de RRHH"]), empresa: emp2, sector: size2, periodo: yearRange(2, Math.min(totalYears, 5)), logros: sample(RRHH_NEUTRAL, 3) });
  }

  const hab: string[] = [];
  if (o.planillas) hab.push("Planillas y remuneraciones", "PLAME", "T-Registro", "AFPnet");
  if (o.excel) hab.push(`Excel ${o.excel}`);
  if (o.reclut) hab.push("Reclutamiento y selección", "Entrevistas por competencias");
  if (o.legislacion) hab.push("Legislación laboral", "Contratos", "SUNAFIL");
  hab.push("Administración de personal", "Control de asistencia", "Gestión de legajos");

  const perfil = o.years
    ? `${cargo} con ${o.years} años de experiencia en recursos humanos y administración de personal.${o.planillas ? " Especialista en planillas y remuneraciones." : ""} Persona organizada, con trato cordial y manejo de información confidencial del personal.`
    : `Asistente con interés en recursos humanos y administración de personal. Apoyo en tareas administrativas del área y manejo de documentación del personal.`;

  const cursos = sample(RRHH_CURSOS_NEUTRAL, rint(2, 3));
  if (o.planillas && chance(0.6)) cursos.push("Planillas y PLAME - Academia Ficticia Laboral (2023)");
  if (o.legislacion && chance(0.5)) cursos.push("Legislación laboral peruana (2024)");

  return {
    titular: cargo,
    disponibilidad: pick(["Inmediata", "A 15 días", "Inmediata (presencial)"]),
    perfil, exp,
    formacion: [`${pick(RRHH_EDU)} (${2026 - totalYears - rint(1, 3)} - ${2026 - rint(0, 2)})${chance(0.5) ? ", bachiller" : ", titulado"}`],
    cursos, habilidades: hab, competencias: sample(COMPETENCIAS, 5), idiomas: idiomas(),
  };
}

const RRHH_OFF: Cv[] = [
  {
    titular: "Desarrollador Web", disponibilidad: "Inmediata",
    perfil: "Desarrollador web con 4 años de experiencia construyendo aplicaciones con React y Node.js. Busco proyectos retadores en tecnología.",
    exp: [
      { cargo: "Desarrollador Full Stack", empresa: "Software Ficticio SAC", sector: "tecnología", periodo: yearRange(4), logros: ["Desarrollo de aplicaciones web con React y TypeScript.", "APIs REST con Node.js y Express.", "Consultas a base de datos PostgreSQL.", "Control de versiones con Git."] },
      { cargo: "Programador Junior", empresa: "Agencia Ficticia Digital", sector: "agencia", periodo: yearRange(2, 4), logros: ["Maquetación con HTML, CSS y React.", "Corrección de errores."] },
    ],
    formacion: ["Ingeniería de Sistemas - Universidad Ficticia (2015 - 2020)"], cursos: ["Scrum Fundamentals", "Clean Code"], habilidades: ["React", "Node.js", "SQL", "Git", "JavaScript"], competencias: ["Trabajo en equipo", "Resolución de problemas"], idiomas: ["Español nativo", "Inglés intermedio (B1)"],
  },
  {
    titular: "Vendedor de Tienda", disponibilidad: "Inmediata",
    perfil: "Vendedor con 6 años de experiencia en atención al público y cierre de ventas en tienda de electrodomésticos.",
    exp: [
      { cargo: "Vendedor de Piso", empresa: "Electro Ficticia Perú SAC", sector: "retail", periodo: yearRange(6), logros: ["Cumplimiento de cuota mensual de ventas durante 4 años.", "Asesoría a clientes en financiamiento y garantías.", "Manejo de caja y cierre diario.", "Reposición y orden de mercadería."] },
      { cargo: "Promotor", empresa: "Eventos Ficticios Perú", sector: "activaciones", periodo: yearRange(2, 6), logros: ["Promoción de productos en activaciones.", "Atención al cliente."] },
    ],
    formacion: ["Secundaria completa - I.E. Ficticia", "Curso de ventas (2021)"], cursos: ["Atención al cliente (2022)"], habilidades: ["Ventas en piso", "Atención al cliente", "Manejo de caja"], competencias: ["Comunicación", "Persuasión", "Orientación al cliente"], idiomas: ["Español nativo"],
  },
  {
    titular: "Técnico en Mecánica Automotriz", disponibilidad: "A 15 días",
    perfil: "Técnico mecánico con 7 años de experiencia en mantenimiento y reparación de vehículos livianos.",
    exp: [
      { cargo: "Mecánico Automotriz", empresa: "Taller Ficticio AutoSur EIRL", sector: "automotriz", periodo: yearRange(7), logros: ["Diagnóstico y reparación de motores a gasolina y diésel.", "Mantenimiento preventivo de flota de 12 vehículos.", "Uso de scanner automotriz.", "Capacitación a 2 ayudantes."] },
      { cargo: "Ayudante de Mecánica", empresa: "Servicentro Ficticio", sector: "automotriz", periodo: yearRange(2, 7), logros: ["Cambio de aceite y frenos.", "Apoyo en reparaciones."] },
    ],
    formacion: ["Técnico en Mecánica Automotriz - Instituto Ficticio Industrial (2014 - 2016)"], cursos: ["Inyección electrónica (2022)"], habilidades: ["Diagnóstico mecánico", "Scanner automotriz", "Mantenimiento preventivo"], competencias: ["Trabajo en equipo", "Responsabilidad"], idiomas: ["Español nativo"],
  },
  {
    titular: "Licenciada en Enfermería", disponibilidad: "Inmediata",
    perfil: "Licenciada en enfermería colegiada con 5 años de experiencia asistencial en hospitalización.",
    exp: [
      { cargo: "Enfermera Asistencial", empresa: "Clínica Ficticia del Sur", sector: "salud", periodo: yearRange(5), logros: ["Atención de pacientes en hospitalización.", "Administración de medicamentos y control de vías.", "Registro de notas de enfermería.", "Educación sanitaria a pacientes."] },
      { cargo: "Enfermera de Consulta Externa", empresa: "Centro Médico Ficticio", sector: "salud", periodo: yearRange(2, 5), logros: ["Triaje y preparación de pacientes.", "Apoyo en inmunizaciones."] },
    ],
    formacion: ["Enfermería - Universidad Ficticia (2013 - 2018), colegiada"], cursos: ["Soporte vital básico (2023)"], habilidades: ["Atención asistencial", "Administración de medicamentos", "Bioseguridad"], competencias: ["Empatía", "Responsabilidad", "Trabajo bajo presión"], idiomas: ["Español nativo", "Inglés básico (A2)"],
  },
];

function rrhhFor(tier: Tier, i: number): Cv {
  switch (tier) {
    case "alta": return rrhhCv({ years: rint(3, 7), planillas: true, excel: "avanzado", reclut: true, legislacion: chance(0.7) });
    case "parcial_alta": return rrhhCv({ years: rint(1, 3), planillas: true, excel: "avanzado", reclut: false, legislacion: false });
    case "parcial": return chance(0.5)
      ? rrhhCv({ years: rint(1, 2), planillas: true, excel: "intermedio", reclut: chance(0.5), legislacion: false })
      : rrhhCv({ years: rint(1, 2), planillas: false, excel: "intermedio", reclut: true, legislacion: false });
    case "baja": return rrhhCv({ years: 1, planillas: false, excel: "básico", reclut: false, legislacion: false });
    case "off": return RRHH_OFF[i % RRHH_OFF.length]!;
  }
}

// --- HTML → PDF ---------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function html(cv: Cv, id: Identity): string {
  const exp = cv.exp.map((e) => `<div class="item"><div class="row"><b>${esc(e.cargo)}</b><span>${esc(e.periodo)}</span></div><div class="emp">${esc(e.empresa)}${e.sector ? ` · ${esc(e.sector)}` : ""}</div><ul>${e.logros.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>CV ${esc(id.nombre)} ${esc(id.apellido)}</title>
<style>@page{margin:13mm 15mm}body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#222;line-height:1.38;margin:0}
h1{font-size:21pt;margin:0;color:#1f3a5f}.tit{font-size:11.5pt;color:#444;margin:2px 0 3px;font-weight:bold}
.contacto{font-size:9pt;color:#555}.contacto2{font-size:9pt;color:#555;border-bottom:2px solid #1f3a5f;padding-bottom:7px;margin-top:2px}
h2{font-size:10.5pt;text-transform:uppercase;letter-spacing:.3px;color:#1f3a5f;border-bottom:1px solid #ccc;margin:13px 0 5px;padding-bottom:2px}
.row{display:flex;justify-content:space-between}.row span{color:#555;font-size:9pt}.emp{font-style:italic;color:#444;margin-bottom:2px}
ul{margin:3px 0 7px 17px;padding:0}li{margin-bottom:2px}p{margin:3px 0}.item{page-break-inside:avoid;margin-bottom:7px}
.tags{color:#333}.nota{margin-top:14px;font-size:7.5pt;color:#999}</style></head><body>
<h1>${esc(id.nombre)} ${esc(id.apellido)}</h1>
<div class="tit">${esc(cv.titular)}</div>
<div class="contacto">${esc(id.correo)} &nbsp;|&nbsp; ${esc(id.telefono)} &nbsp;|&nbsp; ${esc(id.ciudad)}</div>
<div class="contacto2">${esc(id.linkedin)} &nbsp;|&nbsp; Disponibilidad: ${esc(cv.disponibilidad)}</div>
<h2>Perfil profesional</h2><p>${esc(cv.perfil)}</p>
<h2>Experiencia laboral</h2>${exp}
<h2>Formación académica</h2><ul>${cv.formacion.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<h2>Cursos y certificaciones</h2><ul>${cv.cursos.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
<h2>Habilidades técnicas</h2><p class="tags">${cv.habilidades.map(esc).join(" · ")}</p>
<h2>Competencias</h2><p class="tags">${cv.competencias.map(esc).join(" · ")}</p>
<h2>Idiomas</h2><p class="tags">${cv.idiomas.map(esc).join(" · ")}</p>
<div class="nota">CV ficticio generado para pruebas de demostración. Datos inventados.</div>
</body></html>`;
}

// --- Definición de los puestos ------------------------------------------------
type KillerSeed =
  | { question: string; type: "si_no"; expected: boolean }
  | { question: string; type: "numero"; comparator: "mayor o igual a" | "menor o igual a" | "igual a"; threshold: number }
  | { question: string; type: "opcion_unica"; options: string[]; accepted: string[] };

interface Job {
  folder: string; title: string; department: string; location: string;
  modality: Enums<"work_modality">; employment: Enums<"employment_type">; opening: string; closing: string;
  description: string; responsibilities: string;
  requirements: RequirementInput[]; killers: KillerSeed[];
  city: string; plan: [Tier, number][]; cvFor: (tier: Tier, i: number) => Cv;
}

const PLAN: [Tier, number][] = [["alta", 5], ["parcial_alta", 4], ["parcial", 4], ["baja", 3], ["off", 4]];

const JOBS: Job[] = [
  {
    folder: "01_Desarrollador_Full_Stack", title: "Desarrollador Full Stack", department: "Tecnología", location: "Lima",
    modality: "hibrido", employment: "tiempo_completo", opening: "2026-11-01", closing: "2027-01-31",
    description:
      "Buscamos un(a) Desarrollador(a) Full Stack para construir y mantener las aplicaciones web internas de la empresa, de punta a punta (frontend y backend). Trabajará junto al equipo de Tecnología en el desarrollo de nuevas funcionalidades, la mejora de los sistemas existentes y la integración con bases de datos y servicios internos. Modalidad híbrida desde Lima.",
    responsibilities:
      "• Desarrollar interfaces web con React y mantener componentes reutilizables.\n• Construir y consumir APIs (Node.js/Express o Laravel/PHP).\n• Diseñar y optimizar consultas a bases de datos SQL (PostgreSQL o MySQL).\n• Versionar el código con Git y participar en revisiones de código.\n• Colaborar con el equipo en estimaciones, pruebas y despliegues.",
    requirements: [
      { id: "r-react", category: "herramienta", priority: "obligatorio", description: "React", keywords: ["react", "reactjs"], weight: 9, minYears: null, isEssential: false },
      { id: "r-backend", category: "habilidad_tecnica", priority: "obligatorio", description: "Node.js o Laravel/PHP", keywords: ["node", "nodejs", "laravel", "php", "express"], weight: 8, minYears: null, isEssential: false },
      { id: "r-sql", category: "habilidad_tecnica", priority: "obligatorio", description: "Bases de datos SQL", keywords: ["sql", "postgresql", "mysql", "base de datos"], weight: 7, minYears: null, isEssential: false },
      { id: "r-ts", category: "herramienta", priority: "deseable", description: "TypeScript", keywords: ["typescript", "ts"], weight: 5, minYears: null, isEssential: false },
      { id: "r-git", category: "herramienta", priority: "deseable", description: "Git", keywords: ["git", "github", "gitlab"], weight: 4, minYears: null, isEssential: false },
      { id: "r-exp", category: "experiencia", priority: "obligatorio", description: "Experiencia en desarrollo web", keywords: ["desarrollo web", "full stack", "frontend", "backend"], weight: 6, minYears: 2, isEssential: false },
    ],
    killers: [
      { question: "¿Resides en Lima o puedes trasladarte?", type: "si_no", expected: true },
      { question: "¿Cuántos años de experiencia en desarrollo web tienes?", type: "numero", comparator: "mayor o igual a", threshold: 2 },
      { question: "¿Tienes disponibilidad para modalidad híbrida?", type: "si_no", expected: true },
    ],
    city: "Lima", plan: PLAN, cvFor: devFor,
  },
  {
    folder: "02_Asistente_RRHH", title: "Asistente de Recursos Humanos", department: "Recursos Humanos", location: "Lima",
    modality: "presencial", employment: "tiempo_completo", opening: "2026-11-01", closing: "2027-01-31",
    description:
      "Buscamos un(a) Asistente de Recursos Humanos para apoyar la gestión de planillas, el reclutamiento y la administración del personal. Dará soporte en el cálculo de remuneraciones, el filtrado de CV, la coordinación de entrevistas y el mantenimiento de los legajos. Puesto presencial en Lima, con trato directo con todas las áreas de la empresa.",
    responsibilities:
      "• Elaborar las planillas y remuneraciones mensuales del personal.\n• Apoyar el reclutamiento y la selección: avisos, filtrado de CV y coordinación de entrevistas.\n• Mantener actualizados los legajos y la documentación del personal.\n• Dar soporte en contratos y en el cumplimiento de la legislación laboral peruana.\n• Elaborar reportes del área en Excel.",
    requirements: [
      { id: "r-planillas", category: "habilidad_tecnica", priority: "obligatorio", description: "Gestión de planillas", keywords: ["planillas", "nómina", "remuneraciones"], weight: 8, minYears: null, isEssential: false },
      { id: "r-excel", category: "herramienta", priority: "obligatorio", description: "Excel avanzado", keywords: ["excel", "hojas de cálculo", "tablas dinámicas"], weight: 7, minYears: null, isEssential: false },
      { id: "r-reclut", category: "habilidad_tecnica", priority: "deseable", description: "Reclutamiento y selección", keywords: ["reclutamiento", "selección", "entrevistas"], weight: 6, minYears: null, isEssential: false },
      { id: "r-ley", category: "habilidad_tecnica", priority: "deseable", description: "Legislación laboral peruana", keywords: ["legislación laboral", "sunafil", "contratos"], weight: 5, minYears: null, isEssential: false },
      { id: "r-exp", category: "experiencia", priority: "obligatorio", description: "Experiencia en RRHH", keywords: ["recursos humanos", "rrhh", "personal"], weight: 6, minYears: 1, isEssential: false },
    ],
    killers: [
      { question: "¿Tienes experiencia elaborando planillas?", type: "si_no", expected: true },
      { question: "¿Cuál es tu nivel de Excel?", type: "opcion_unica", options: ["Básico", "Intermedio", "Avanzado"], accepted: ["Intermedio", "Avanzado"] },
      { question: "¿Cuántos años de experiencia en RRHH tienes?", type: "numero", comparator: "mayor o igual a", threshold: 1 },
    ],
    city: "Lima", plan: PLAN, cvFor: rrhhFor,
  },
];

// --- Ficha de puesto en texto (para copiar y pegar) ---------------------------
function fichaTxt(job: Job, n: number): string {
  const L: string[] = [];
  L.push("================================================================");
  L.push(`PUESTO ${n}: ${job.title}`);
  L.push("================================================================");
  L.push("");
  L.push("— DATOS GENERALES —");
  L.push(`Título del puesto: ${job.title}`);
  L.push(`Área / Departamento: ${job.department}`);
  L.push(`Ubicación: ${job.location}`);
  L.push(`Modalidad: ${WORK_MODALITY_LABELS[job.modality]}`);
  L.push(`Tipo de contrato: ${EMPLOYMENT_TYPE_LABELS[job.employment]}`);
  L.push(`Fecha de apertura: ${job.opening}`);
  L.push(`Fecha de cierre: ${job.closing}`);
  L.push("");
  L.push("— DESCRIPCIÓN —");
  L.push(job.description);
  L.push("");
  L.push("— RESPONSABILIDADES —");
  L.push(job.responsibilities);
  L.push("");
  L.push("— REQUISITOS Y CRITERIOS (con peso y prioridad) —");
  job.requirements.forEach((r, idx) => {
    L.push(`${idx + 1}. ${r.description}`);
    L.push(`   Categoría: ${REQUIREMENT_CATEGORY_LABELS[r.category]}`);
    L.push(`   Prioridad: ${REQUIREMENT_PRIORITY_LABELS[r.priority]}`);
    L.push(`   Peso: ${r.weight}`);
    L.push(`   Palabras clave: ${r.keywords.join(", ")}`);
    if (r.minYears != null) L.push(`   Años mínimos de experiencia: ${r.minYears}`);
  });
  L.push("");
  L.push("— PREGUNTAS ELIMINATORIAS (marcan, no excluyen) —");
  job.killers.forEach((k, idx) => {
    L.push(`${idx + 1}. ${k.question}`);
    L.push(`   Tipo: ${KILLER_QUESTION_TYPE_LABELS[k.type]}`);
    if (k.type === "si_no") L.push(`   Respuesta que cumple: ${k.expected ? "Sí" : "No"}`);
    else if (k.type === "numero") L.push(`   Condición para cumplir: ${k.comparator} ${k.threshold}`);
    else { L.push(`   Opciones: ${k.options.join(", ")}`); L.push(`   Opciones que cumplen: ${k.accepted.join(", ")}`); }
  });
  L.push("");
  L.push(`CV de prueba para este puesto: cv-prueba/demo/${job.folder}/ (${CV_POR_PUESTO} archivos PDF)`);
  L.push("");
  return L.join("\n");
}

// --- Main ---------------------------------------------------------------------
interface Row { nombre: string; tier: Tier; score: number; level: string }

async function main() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const txtParts: string[] = [
    "FICHAS DE PUESTOS — DEMOSTRACIÓN",
    "Copie y pegue estos datos al crear cada vacante manualmente en la app.",
    "Todos los datos (puestos y CV) son ficticios.",
    "",
  ];
  let globalIndex = 0;

  for (const [jn, job] of JOBS.entries()) {
    txtParts.push(fichaTxt(job, jn + 1));
    const dir = path.join(ROOT, job.folder);
    mkdirSync(dir, { recursive: true });

    const tiers: Tier[] = [];
    for (const [tier, c] of job.plan) for (let k = 0; k < c; k++) tiers.push(tier);
    while (tiers.length < CV_POR_PUESTO) tiers.push("parcial");
    for (let k = tiers.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [tiers[k], tiers[j]] = [tiers[j]!, tiers[k]!]; }

    const rows: Row[] = [];
    for (let i = 0; i < CV_POR_PUESTO; i++) {
      globalIndex++;
      const tier = tiers[i]!;
      const id = identity(globalIndex, job.city);
      const cv = job.cvFor(tier, i);
      await page.setContent(html(cv, id), { waitUntil: "load" });
      const bytes = new Uint8Array(await page.pdf({ format: "A4", printBackground: true }));
      const file = `CV_${String(i + 1).padStart(2, "0")}_${sinTildes(id.apellido.split(" ")[0]!)}_${sinTildes(id.nombre.split(" ")[0]!)}.pdf`;
      writeFileSync(path.join(dir, file), bytes);

      const extraction = await extractResume(bytes, "pdf");
      const items = evaluateWithRules(extraction.text ?? "", job.requirements, { referenceDate: new Date("2026-11-13") });
      const result = assembleEvaluation({ method: "reglas", methodVersion: RULE_ENGINE_VERSION, model: null, requirements: job.requirements, items, textWasCorrected: false, textTruncated: false });
      rows.push({ nombre: `${id.nombre} ${id.apellido}`, tier, score: result.scores.score, level: result.level });
      process.stdout.write(`\r  ${job.title}: ${i + 1}/${CV_POR_PUESTO}   `);
    }
    process.stdout.write("\n");

    rows.sort((a, b) => b.score - a.score);
    const byLevel: Record<string, number> = {};
    for (const r of rows) byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
    console.log(`\n### ${job.title} — ${CV_POR_PUESTO} CV en cv-prueba/demo/${job.folder}/`);
    console.log("  Niveles:", Object.entries(byLevel).map(([l, c]) => `${l}=${c}`).join("  "));
    console.log("  Top 6:");
    for (const r of rows.slice(0, 6)) console.log(`    ${String(r.score).padStart(6)}  ${r.level.padEnd(9)}  ${r.nombre}`);
    console.log("  Últimos 3:");
    for (const r of rows.slice(-3)) console.log(`    ${String(r.score).padStart(6)}  ${r.level.padEnd(9)}  ${r.nombre}`);
  }

  await browser.close();
  const txtPath = path.join(ROOT, "PUESTOS.txt");
  writeFileSync(txtPath, txtParts.join("\n"), "utf8");
  console.log(`\n✔ Fichas de puestos: ${txtPath}`);
  console.log(`✔ CVs en: ${ROOT}\\<puesto>\\`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
