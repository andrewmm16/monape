import { excerpt, findTermOccurrences, normalizeForSearch } from "@/modules/evaluation/text";

/**
 * Sugerencias detectadas en el texto del CV. Solo se devuelven valores que
 * aparecen literalmente en el documento, con el fragmento que los respalda.
 * Nada se aplica a la ficha del candidato sin una acción de RRHH.
 */
export type Suggestion = { value: string; evidence: string };

export type SuggestedFields = {
  email?: Suggestion;
  phone?: Suggestion;
  linkedin_url?: Suggestion;
  skills: Suggestion[];
};

export const SUGGESTIONS_VERSION = "sugerencias-v1";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+\/?/i;
const PHONE_CANDIDATES = /\+?\(?\d[\d\s().-]{6,18}\d/g;

/**
 * Herramientas y tecnologías frecuentes en ofertas del mercado peruano.
 * Ampliable: no es una lista de requisitos, solo ayuda a registrar habilidades.
 */
export const SKILL_DICTIONARY = [
  "Excel", "Word", "PowerPoint", "Power BI", "Tableau", "SAP", "SAP FI", "SAP MM", "Oracle", "SQL",
  "MySQL", "PostgreSQL", "SQL Server", "Python", "Java", "JavaScript", "TypeScript", "React",
  "Angular", "Node.js", "PHP", "Laravel", ".NET", "C#", "Kotlin", "Swift", "Git", "Docker",
  "Kubernetes", "AWS", "Azure", "Google Cloud", "Linux", "Jira", "Scrum", "Kanban", "ITIL",
  "AutoCAD", "Revit", "Civil 3D", "SketchUp", "S10", "MS Project", "Primavera P6", "Salesforce",
  "HubSpot", "Odoo", "Concar", "Siscont", "PLAME", "PDT", "Contasis", "Photoshop", "Illustrator",
  "Figma", "Google Analytics", "Lean Six Sigma", "ISO 9001", "ISO 45001", "ISO 14001",
] as const;

function snippetAround(text: string, index: number, length: number): string {
  const from = Math.max(0, index - 40);
  const to = Math.min(text.length, index + length + 40);
  return text.slice(from, to).replace(/\s+/g, " ").trim();
}

function findPhone(text: string): Suggestion | undefined {
  for (const match of text.matchAll(PHONE_CANDIDATES)) {
    const raw = match[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    // Descarta rangos de años ("2018 - 2021") y fechas.
    if (/^(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}$/.test(raw)) continue;
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(raw)) continue;
    const peruMobile = /^(?:51)?9\d{8}$/.test(digits);
    const hasPlus = raw.startsWith("+");
    if (peruMobile || hasPlus || digits.length >= 9) {
      return { value: raw, evidence: snippetAround(text, match.index ?? 0, raw.length) };
    }
  }
  return undefined;
}

export function suggestFields(text: string): SuggestedFields {
  const result: SuggestedFields = { skills: [] };

  const email = EMAIL.exec(text);
  if (email) result.email = { value: email[0], evidence: snippetAround(text, email.index, email[0].length) };

  const linkedin = LINKEDIN.exec(text);
  if (linkedin) {
    const value = linkedin[0].startsWith("http") ? linkedin[0] : `https://${linkedin[0]}`;
    result.linkedin_url = { value, evidence: snippetAround(text, linkedin.index, linkedin[0].length) };
  }

  const phone = findPhone(text);
  if (phone) result.phone = phone;

  const haystack = normalizeForSearch(text);
  for (const skill of SKILL_DICTIONARY) {
    const [match] = findTermOccurrences(haystack, skill, 1);
    if (match) result.skills.push({ value: skill, evidence: excerpt(text, haystack, match, 40).quote });
  }

  return result;
}

// --- Sugerencia de nombre ---------------------------------------------------

/**
 * Palabras de encabezados y secciones habituales de un CV. Una línea que
 * contenga alguna no se propone como nombre («Currículum vitae», «Hoja de
 * vida», «Perfil profesional», «Experiencia laboral»...).
 */
const NON_NAME_WORDS = new Set([
  "curriculum", "vitae", "cv", "resume", "hoja", "vida", "perfil", "profesional", "resumen", "datos",
  "personales", "personal", "informacion", "contacto", "experiencia", "laboral", "formacion", "academica",
  "educacion", "estudios", "habilidades", "competencias", "idiomas", "conocimientos", "referencias",
  "objetivo", "cursos", "certificaciones", "universidad", "instituto", "colegio", "empresa", "ingeniero",
  "ingeniera", "analista", "gerente", "asistente", "practicante", "declaracion", "jurada", "anexo",
]);

/** Partículas que pueden ir en minúscula dentro de un nombre. */
const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "da", "di", "van", "von", "san"]);

const NAME_LINES_TO_SCAN = 12;
const NAME_WORD = /^\p{L}[\p{L}'’-]*$/u;

function looksLikeName(line: string): boolean {
  if (/[\d@]/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((word) => {
    if (!NAME_WORD.test(word)) return false;
    if (NON_NAME_WORDS.has(plainWord(word))) return false;
    if (NAME_PARTICLES.has(word.toLowerCase())) return true;
    // Un nombre propio empieza con mayúscula.
    return word[0] !== word[0]!.toLowerCase() && word.length >= 2;
  });
}

/**
 * Propone el nombre del candidato: la primera línea (entre las primeras del
 * documento) con forma de nombre, de 2 a 5 palabras, solo letras, sin cifras ni
 * arrobas y sin encabezados de CV. Es solo una sugerencia con su evidencia:
 * RRHH la revisa antes de registrar a nadie.
 */
export function suggestName(text: string): Suggestion | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, NAME_LINES_TO_SCAN);
  for (const line of lines) {
    if (looksLikeName(line)) return { value: line, evidence: line.slice(0, 120) };
  }
  return undefined;
}

function plainWord(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
