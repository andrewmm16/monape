import { normalizeTerm } from "./text";
import type { RequirementInput } from "./types";

/**
 * Evidencia RELACIONADA (reglas-v10): cargos o habilidades PARECIDOS a lo que pide
 * el requisito, pero no equivalentes. A diferencia de las equivalencias de
 * synonyms.ts, que acreditan, una relación solo convierte un «sin evidencia» en
 * «pendiente» con una pista para RRHH: «no dice residente de obra, pero sí
 * asistente de residencia». Nunca acredita ni cambia el puntaje (pendiente y sin
 * evidencia cuentan igual: ambos son «por confirmar»).
 *
 * Dos fuentes:
 *  - RELATED_GROUPS: lista fija y revisada. Si la descripción del requisito pide
 *    algo de `pedidos`, se buscan los `relacionados`.
 *  - Núcleo automático (solo habilidades técnicas): el término «negociación de
 *    contratos» se acorta a su palabra principal, «negociación». Las palabras demasiado
 *    genéricas (GENERIC_HEADS) no cuentan como núcleo, para no dar pistas falsas.
 *
 * Módulo puro: solo decide QUÉ buscar; la búsqueda (con negaciones, intereses y
 * terceros) la hace el motor igual que con los términos configurados.
 */
export const RELATED_GROUPS: ReadonlyArray<{ pedidos: readonly string[]; relacionados: readonly string[] }> = [
  {
    // Obra: el cargo de dirección frente a los de apoyo o de ejecución directa.
    pedidos: ["residente de obra", "supervisor de obra", "ingeniero de campo", "ingeniero residente", "jefe de obra", "supervisión de obras"],
    relacionados: [
      "asistente de residencia",
      "asistente de residente",
      "asistente de obra",
      "asistente técnico de obra",
      "asistente de supervisión",
      "maestro de obra",
      "capataz",
      "ingeniero asistente",
    ],
  },
  {
    // Atención al cliente: puestos de trato directo con el público sin ser el área.
    pedidos: ["atención al cliente", "servicio al cliente", "contact center", "call center", "experiencia del cliente"],
    relacionados: [
      "recepcionista",
      "recepción de visitas",
      "anfitriona",
      "anfitrión",
      "cajera",
      "cajero",
      "teleoperador",
      "teleoperadora",
      "operador telefónico",
      "atención de llamadas",
      "mesa de ayuda",
      "counter",
    ],
  },
  {
    // Ventas a empresas frente a la venta en campo o a canales.
    pedidos: ["B2B", "cuentas clave", "key account", "ventas corporativas", "ventas a empresas"],
    relacionados: [
      // «Vendedor» a secas no: una vendedora de tienda vende a cliente final (B2C).
      "asesor comercial",
      "ejecutivo de ventas",
      "vendedor de campo",
      "ventas en campo",
      "canal moderno",
      "canal tradicional",
      "distribuidores",
      "mayoristas",
      "cartera de clientes",
    ],
  },
  {
    // Negociación de contratos frente a la negociación en general.
    pedidos: ["negociación de contratos", "contratos marco"],
    relacionados: ["negociación comercial", "negociación con proveedores", "técnicas de negociación", "negociación"],
  },
  {
    // Enfermería: la licenciatura frente a los puestos técnicos o auxiliares.
    pedidos: ["licenciada en enfermería", "licenciado en enfermería", "enfermera asistencial", "enfermero asistencial", "enfermería asistencial"],
    relacionados: ["técnica de enfermería", "técnico de enfermería", "técnica en enfermería", "técnico en enfermería", "auxiliar de enfermería"],
  },
  {
    // Contabilidad: el cargo contable frente a los de apoyo administrativo.
    pedidos: ["contador", "analista contable", "contabilidad general"],
    relacionados: ["auxiliar contable", "asistente contable", "practicante contable", "asistente administrativo contable"],
  },
  {
    // Planillas: el área de remuneraciones frente al apoyo general de RR. HH.
    pedidos: ["planillas", "remuneraciones", "nóminas"],
    relacionados: ["asistente de recursos humanos", "auxiliar de recursos humanos", "asistente de RRHH", "analista de compensaciones"],
  },
  {
    // Logística: coordinación frente a la operación de almacén.
    pedidos: ["coordinador de logística", "jefe de almacén", "supervisor de almacén", "jefe de logística"],
    relacionados: ["asistente de almacén", "auxiliar de almacén", "almacenero", "asistente de logística", "despachador", "operario de almacén"],
  },
  {
    // Desarrollo de software frente a puestos técnicos vecinos.
    pedidos: ["desarrollador", "programador", "desarrollo web", "full stack"],
    relacionados: ["practicante de sistemas", "practicante de desarrollo", "soporte técnico", "técnico de sistemas", "maquetador", "diseñador web"],
  },
];

/** Categorías en las que se buscan relacionados de la lista fija. */
const RELATED_SCOPE = new Set<RequirementInput["category"]>(["experiencia", "habilidad_tecnica", "otro"]);

/** Palabras vacías que no pueden ser núcleo. */
const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "en", "y", "e", "o", "u", "a", "al", "para", "con", "por", "su", "sus", "un", "una"]);

/**
 * Palabras demasiado genéricas para ser el núcleo de un término: «gestión de
 * reclamos» no se acorta a «gestión» (aparece en cualquier CV), y «análisis de
 * datos» no se acorta a «análisis» («análisis de cuentas por cobrar» no es lo mismo).
 */
export const GENERIC_HEADS = new Set(
  [
    "gestión", "manejo", "control", "conocimiento", "conocimientos", "experiencia", "elaboración", "análisis",
    "administración", "uso", "dominio", "nivel", "básico", "básica", "intermedio", "intermedia", "avanzado", "avanzada",
    "buen", "buena", "sólido", "sólida", "técnicas", "técnica", "herramientas", "herramienta", "procesos", "proceso",
    "atención", "seguimiento", "apoyo", "desarrollo", "operación", "operaciones", "área", "sistema", "sistemas",
    "programa", "programas", "servicio", "servicios", "calidad", "trabajo", "equipo", "cliente", "clientes", "empresa",
    "empresas", "manejo", "registro", "registros", "atención", "documentos", "documentación", "reportes", "informes",
    "planificación", "coordinación", "supervisión", "ejecución", "implementación", "mantenimiento", "cuentas",
  ].map(normalizeTerm),
);

/** Longitud mínima del núcleo, para no buscar palabras cortas y ambiguas. */
const MIN_HEAD_LENGTH = 5;

/**
 * Términos de la lista fija relacionados con el requisito (sin los ya configurados).
 * El grupo se aplica solo si lo pedido está escrito en la DESCRIPCIÓN del requisito,
 * no basta con los términos de búsqueda: RRHH a veces usa un cargo como indicio de
 * otra cosa («Supervisor de Almacén» para «Experiencia liderando equipos»), y ahí un
 * «asistente de almacén» no es una pista de liderazgo.
 */
export function relatedListTerms(requirement: Pick<RequirementInput, "category" | "description" | "keywords">): string[] {
  if (!RELATED_SCOPE.has(requirement.category)) return [];
  const description = ` ${normalizeTerm(requirement.description)} `;
  const own = new Set(requirement.keywords.map(normalizeTerm));
  const out: string[] = [];
  for (const group of RELATED_GROUPS) {
    const applies = group.pedidos.some((p) => description.includes(` ${normalizeTerm(p)} `));
    if (!applies) continue;
    for (const r of group.relacionados) {
      const n = normalizeTerm(r);
      if (!own.has(n) && !out.some((o) => normalizeTerm(o) === n)) out.push(r);
    }
  }
  return out;
}

/**
 * Núcleos automáticos de los términos de una habilidad técnica: la primera
 * palabra con contenido de un término de varias palabras («negociación de
 * contratos» → «negociación»), si no es genérica ni corta. Devuelve núcleo → término
 * de origen, para explicar la pista.
 */
export function coreTerms(requirement: Pick<RequirementInput, "category" | "keywords">): Map<string, string> {
  const out = new Map<string, string>();
  if (requirement.category !== "habilidad_tecnica") return out;
  const own = new Set(requirement.keywords.map(normalizeTerm));
  for (const keyword of requirement.keywords) {
    const words = normalizeTerm(keyword).split(/\s+/).filter((w) => w !== "" && !STOPWORDS.has(w));
    if (words.length < 2) continue;
    const head = words[0]!;
    if (head.length < MIN_HEAD_LENGTH || GENERIC_HEADS.has(head) || /\d/.test(head) || own.has(head)) continue;
    // Se conserva la grafía original (con tildes) para mostrarla a RRHH.
    const display = keyword.trim().split(/\s+/).find((w) => normalizeTerm(w) === head)?.toLowerCase() ?? head;
    if (![...out.keys()].some((k) => normalizeTerm(k) === head)) out.set(display, keyword.trim());
  }
  return out;
}
