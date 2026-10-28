import { findTermOccurrences, normalizeForSearch, normalizeTerm } from "@/modules/evaluation/text";

/**
 * Sugerencia de términos relacionados al definir un requisito. Diccionario fijo
 * (sin IA ni servicios externos): un grupo se activa cuando alguno de sus
 * términos aparece, como palabra completa, en la descripción del requisito o en
 * los términos ya escritos. Módulo puro, apto para el cliente.
 */
export const TERM_GROUPS: ReadonlyArray<{ name: string; terms: readonly string[] }> = [
  { name: "Excel", terms: ["Excel", "Excel avanzado", "tablas dinámicas", "macros", "VBA", "Power Query", "Power Pivot", "BUSCARV"] },
  { name: "Power BI", terms: ["Power BI", "DAX", "Power Query", "Power Pivot"] },
  { name: "SQL", terms: ["SQL", "SQL Server", "MySQL", "PostgreSQL", "Oracle", "T-SQL", "PL/SQL", "consultas SQL"] },
  {
    name: "Contabilidad",
    terms: ["contabilidad", "contable", "contador", "conciliaciones bancarias", "estados financieros", "NIIF", "cierre contable"],
  },
  { name: "Tributación", terms: ["tributación", "tributario", "SUNAT", "PDT", "PLE", "IGV", "declaraciones juradas"] },
  { name: "Inglés", terms: ["inglés", "English", "TOEFL", "IELTS", "Cambridge", "ICPNA", "Británico"] },
  { name: "SAP", terms: ["SAP", "SAP FI", "SAP CO", "SAP MM", "SAP SD", "S/4HANA"] },
  { name: "Office", terms: ["Microsoft Office", "Word", "PowerPoint", "Outlook"] },
  { name: "Planillas", terms: ["planillas", "nómina", "PLAME", "T-Registro", "AFP", "CTS", "gratificaciones"] },
  { name: "Reclutamiento", terms: ["reclutamiento", "selección de personal", "entrevistas por competencias", "onboarding"] },
  { name: "Logística", terms: ["logística", "almacén", "inventarios", "kardex", "cadena de suministro", "supply chain"] },
  { name: "Compras", terms: ["compras", "adquisiciones", "proveedores", "órdenes de compra", "procurement"] },
  { name: "Ventas", terms: ["ventas", "cartera de clientes", "prospección", "CRM", "Salesforce"] },
  {
    name: "Atención al cliente",
    terms: ["atención al cliente", "servicio al cliente", "customer service", "call center", "postventa"],
  },
  {
    name: "SST",
    terms: ["seguridad y salud en el trabajo", "SST", "ISO 45001", "IPERC", "prevención de riesgos"],
  },
  {
    name: "Calidad",
    terms: ["gestión de calidad", "ISO 9001", "auditorías internas", "mejora continua", "Lean", "Six Sigma"],
  },
  {
    name: "Proyectos",
    terms: ["gestión de proyectos", "PMP", "PMBOK", "Scrum", "metodologías ágiles", "MS Project"],
  },
  { name: "JavaScript", terms: ["JavaScript", "TypeScript", "React", "Node.js", "Next.js", "Angular", "Vue"] },
  { name: "Python", terms: ["Python", "Pandas", "NumPy", "Django", "Flask"] },
  { name: "Java", terms: ["Java", "Spring Boot", "Maven"] },
  { name: ".NET", terms: [".NET", "C#", "ASP.NET"] },
  { name: "CAD/BIM", terms: ["AutoCAD", "Revit", "BIM", "Civil 3D"] },
  { name: "Licencia", terms: ["licencia de conducir", "brevete"] },
  { name: "Marketing digital", terms: ["marketing digital", "Google Ads", "SEO", "SEM", "Google Analytics"] },
  {
    name: "Ingeniería industrial",
    terms: ["ingeniería industrial", "ing. industrial", "ingeniero industrial"],
  },
  {
    name: "Administración",
    terms: ["administración de empresas", "licenciado en administración", "bachiller en administración"],
  },
  { name: "Economía", terms: ["economía", "economista"] },
  { name: "Derecho", terms: ["derecho", "abogado", "abogada"] },
];

/**
 * Términos del diccionario relacionados con la descripción y los términos ya
 * escritos, sin repetir los que ya están y en el orden del diccionario.
 */
export function suggestTerms(description: string, keywords: string[], max = 8): string[] {
  if (max <= 0) return [];
  const haystack = normalizeForSearch([description, ...keywords].join("\n"));
  const existing = new Set(keywords.map(normalizeTerm).filter(Boolean));
  const suggestions: string[] = [];
  for (const group of TERM_GROUPS) {
    if (!group.terms.some((term) => findTermOccurrences(haystack, term, 1).length > 0)) continue;
    for (const term of group.terms) {
      const normalized = normalizeTerm(term);
      if (existing.has(normalized)) continue;
      existing.add(normalized);
      suggestions.push(term);
      if (suggestions.length >= max) return suggestions;
    }
  }
  return suggestions;
}

// Mismos límites que el campo de términos en `schemas.ts` (20 términos, 1000 caracteres).
export const MAX_KEYWORDS = 20;
export const MAX_KEYWORDS_LENGTH = 1000;

/** Separa el campo de términos con los mismos separadores que el esquema. */
export function splitKeywords(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Agrega términos al valor del campo (separados por comas) sin superar los
 * límites del formulario. Agrega solo los que caben, en orden.
 */
export function appendTerms(value: string, terms: string[]): { value: string; added: string[] } {
  const list = splitKeywords(value);
  const known = new Set(list.map(normalizeTerm));
  const added: string[] = [];
  for (const term of terms) {
    const normalized = normalizeTerm(term);
    if (known.has(normalized)) continue;
    if (list.length + 1 > MAX_KEYWORDS) break;
    if ([...list, term].join(", ").length > MAX_KEYWORDS_LENGTH) continue;
    list.push(term);
    known.add(normalized);
    added.push(term);
  }
  return { value: list.join(", "), added };
}
