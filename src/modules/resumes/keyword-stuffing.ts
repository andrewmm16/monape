/**
 * Relleno de palabras clave VISIBLE: un CV que repite un término muchas veces o que
 * trae una lista enorme de términos sueltos que no aparecen en ninguna otra parte
 * del CV (ni en la experiencia ni en la formación), para coincidir con los filtros.
 * Complementa al texto oculto (hidden-text.ts, docx-hidden.ts, pdf-contrast.ts),
 * que cubre el relleno INVISIBLE.
 *
 * Es solo una señal para RRHH: no cambia ningún veredicto ni el puntaje, y el aviso
 * dice «compruebe», nunca «trampa». Los umbrales son altos a propósito (un perfil
 * técnico que lista 25 tecnologías es normal) y están calibrados contra los CV del
 * banco de pruebas, ninguno de los cuales debe disparar el aviso.
 *
 * Módulo puro y determinista: recibe el texto ya extraído (solo lo visible).
 */

/** Una misma palabra con contenido: al menos tantas apariciones… */
export const REPEAT_MIN_COUNT = 12;
/** …y al menos esta proporción de las palabras con contenido del CV. */
export const REPEAT_MIN_SHARE = 0.04;
/**
 * Uso natural, no relleno: la palabra aparece sobre todo en frases (líneas de al menos
 * tantas palabras), como mucho dos veces por línea. Es el caso de la profesión de la
 * persona («música» en el CV de un músico); el relleno se concentra en listas, en
 * líneas cortas o muchas veces en la misma línea.
 */
export const PROSE_MIN_WORDS = 8;
export const NATURAL_PROSE_SHARE = 0.75;
export const NATURAL_MAX_PER_LINE = 2;
/** La misma palabra seguida tantas veces («SAP SAP SAP»). */
export const CONSECUTIVE_MIN = 3;
/** Ítems sueltos en listas a partir de los cuales se mira el respaldo… */
export const LIST_MIN_ITEMS = 40;
/** …y proporción de ítems que solo están en la lista. */
export const LIST_UNBACKED_SHARE = 0.75;

/** Comienzo fijo del aviso, para reconocerlo en código (p. ej., para pedir una segunda opinión). */
export const STUFFING_WARNING_PREFIX = "Posible relleno de palabras clave";

export type StuffingSignals = {
  /** Palabras repetidas por encima de los umbrales, con su grafía en el CV. */
  repeated: Array<{ term: string; count: number; share: number }>;
  /** Palabras escritas varias veces seguidas. */
  consecutive: string[];
  /** Listas de términos sueltos: total de ítems y cuántos no aparecen fuera de la lista. */
  list: { items: number; unbacked: number };
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const WORD = /[\p{L}\p{N}][\p{L}\p{N}+#]*/gu;

/** Palabras vacías y vocabulario habitual de cualquier CV, que no cuentan como repetición. */
const COMMON = new Set(
  [
    "de", "del", "la", "las", "el", "los", "en", "y", "e", "o", "u", "a", "al", "para", "con", "por", "su", "sus", "un",
    "una", "uno", "que", "se", "lo", "como", "mi", "mis", "the", "and", "of", "in", "to", "for", "with",
    "experiencia", "empresa", "trabajo", "gestion", "manejo", "cliente", "clientes", "anos", "ano", "actualidad",
    "mes", "meses", "nivel", "area", "areas", "equipo", "apoyo", "control", "elaboracion", "responsable", "funciones",
    "logros", "habilidades", "formacion", "educacion", "perfil", "resumen", "profesional", "laboral", "idiomas",
    "nativo", "basico", "intermedio", "avanzado", "curso", "cursos", "peru", "lima", "s.a.c", "sac", "eirl",
    // Palabras vacías de otros idiomas (CV en inglés, francés, portugués, alemán o italiano).
    "from", "that", "this", "was", "were", "has", "have", "had", "are", "his", "her", "its", "their", "they",
    "them", "our", "your", "you", "who", "which", "also", "into", "than", "then", "not", "but", "all", "per",
    "des", "les", "une", "pour", "dans", "avec", "sur", "par", "aux", "est", "qui", "pas", "plus", "son", "ses",
    "leur", "cette", "ces", "ete", "uma", "dos", "das", "nas", "nos", "pelo", "pela", "nao", "sem", "sao", "foi",
    "tambem", "der", "die", "und", "von", "mit", "den", "dem", "ein", "eine", "einer", "auf", "fur", "als", "bei",
    "nach", "aus", "wurde", "sich", "ist", "sie", "della", "delle", "dei", "degli", "nel", "nella", "che", "sono",
  ].map(fold),
);

/** Encabezados de secciones de habilidades, donde las líneas cortas son ítems de lista. */
const SKILLS_HEADING = /^(?:habilidades|competencias|conocimientos|skills|herramientas|tecnologias|palabras clave|keywords|aptitudes|software|programas|stack)\b/;
/** Una línea que parece encabezado de sección (todo mayúsculas, corta). */
function isHeading(line: string): boolean {
  const letters = line.replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && line.length <= 40 && letters === letters.toUpperCase() && /\p{Lu}/u.test(letters);
}

const ITEM_SEPARATORS = /\s*[,;|•·▪●■]\s*|\s+[-–]\s+/;

/** Un ítem suelto de lista: de 1 a 4 palabras y corto. */
function isLooseItem(segment: string): boolean {
  const words = segment.match(WORD) ?? [];
  return words.length >= 1 && words.length <= 4 && segment.length <= 40;
}

/**
 * Ítems sueltos de lista: los segmentos de una línea con 3 o más separados por
 * comas o viñetas, y las líneas cortas bajo un encabezado de habilidades hasta el
 * siguiente encabezado. Devuelve los ítems y el índice de las líneas que son lista.
 */
function listItems(lines: string[]): { items: string[]; listLines: Set<number> } {
  const items: string[] = [];
  const listLines = new Set<number>();
  let inSkills = false;
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    if (isHeading(line) || SKILLS_HEADING.test(fold(line))) {
      inSkills = SKILLS_HEADING.test(fold(line));
      // «Habilidades: Excel, SAP, …» en la misma línea del encabezado.
      const rest = line.replace(/^[^:]*:\s*/, "");
      if (!inSkills || rest === line) return;
      const segments = rest.split(ITEM_SEPARATORS).filter((s) => s.trim() !== "");
      if (segments.length > 0 && segments.every(isLooseItem)) {
        items.push(...segments);
        listLines.add(index);
      }
      return;
    }
    const segments = line.split(ITEM_SEPARATORS).filter((s) => s.trim() !== "");
    if (segments.length >= 3 && segments.every(isLooseItem)) {
      items.push(...segments);
      listLines.add(index);
    } else if (inSkills && segments.length >= 1 && segments.every(isLooseItem)) {
      items.push(...segments);
      listLines.add(index);
    }
  });
  return { items, listLines };
}

export function detectKeywordStuffing(text: string): StuffingSignals {
  const lines = text.split("\n");
  const surface = new Map<string, string>();
  const counts = new Map<string, number>();
  /** Por palabra: apariciones dentro de frases y máximo en una misma línea. */
  const inProse = new Map<string, number>();
  const maxPerLine = new Map<string, number>();
  let total = 0;
  const consecutive = new Set<string>();
  let previous = "";
  let run = 0;
  for (const line of lines) {
    const words = [...line.matchAll(WORD)];
    const prose = words.length >= PROSE_MIN_WORDS;
    const inLine = new Map<string, number>();
    for (const match of words) {
      const key = fold(match[0]);
      run = key === previous ? run + 1 : 1;
      previous = key;
      if (key.length < 3 || COMMON.has(key) || /^\d+$/.test(key)) continue;
      if (run >= CONSECUTIVE_MIN) consecutive.add(surface.get(key) ?? match[0]);
      total += 1;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (prose) inProse.set(key, (inProse.get(key) ?? 0) + 1);
      inLine.set(key, (inLine.get(key) ?? 0) + 1);
      if (!surface.has(key)) surface.set(key, match[0]);
    }
    for (const [key, n] of inLine) maxPerLine.set(key, Math.max(maxPerLine.get(key) ?? 0, n));
  }
  const natural = (key: string, count: number) =>
    (inProse.get(key) ?? 0) / count >= NATURAL_PROSE_SHARE && (maxPerLine.get(key) ?? 0) <= NATURAL_MAX_PER_LINE;
  const repeated = [...counts.entries()]
    .filter(([key, count]) => !natural(key, count))
    .map(([key, count]) => ({ term: surface.get(key) ?? key, count, share: total === 0 ? 0 : count / total }))
    .filter((r) => r.count >= REPEAT_MIN_COUNT && r.share >= REPEAT_MIN_SHARE)
    .sort((a, b) => b.count - a.count);

  const { items, listLines } = listItems(lines);
  const outside = ` ${fold(lines.filter((_, i) => !listLines.has(i)).join(" ").replace(/[^\p{L}\p{N}+#]+/gu, " "))} `;
  const backed = (item: string): boolean => {
    const words = (fold(item).match(WORD) ?? []).filter((w) => !COMMON.has(w));
    if (words.length === 0) return true;
    if (outside.includes(` ${words.join(" ")} `)) return true;
    // Respaldo laxo (criterio conservador): basta con su palabra más larga, si es distintiva.
    const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
    return longest.length >= 4 && outside.includes(` ${longest} `);
  };
  const unbacked = items.filter((item) => !backed(item)).length;

  return { repeated, consecutive: [...consecutive], list: { items: items.length, unbacked } };
}

/** Aviso para RRHH, o null si no hay señales por encima de los umbrales. */
export function summarizeStuffing(signals: StuffingSignals): string | null {
  const parts: string[] = [];
  const { items, unbacked } = signals.list;
  if (items >= LIST_MIN_ITEMS && unbacked >= items * LIST_UNBACKED_SHARE) {
    parts.push(`incluye listas con ${items} términos sueltos y ${unbacked} de ellos no aparecen en ninguna otra parte del CV (experiencia, formación)`);
  }
  if (signals.repeated.length > 0) {
    const top = signals.repeated.slice(0, 3).map((r) => `«${r.term}» ${r.count} veces`);
    parts.push(`repite ${top.join(", ")}, más de lo habitual`);
  }
  if (signals.consecutive.length > 0) {
    parts.push(`escribe varias veces seguidas ${signals.consecutive.slice(0, 3).map((t) => `«${t}»`).join(", ")}`);
  }
  if (parts.length === 0) return null;
  return `${STUFFING_WARNING_PREFIX}: el CV ${parts.join("; ")}. Puede haberse escrito para coincidir con los filtros: compruebe en la entrevista que los términos que importan para el puesto estén respaldados por su experiencia. No cambia la evaluación.`;
}

/** ¿Este aviso de extracción es el de relleno de palabras clave? */
export function isStuffingWarning(warning: string): boolean {
  return warning.startsWith(STUFFING_WARNING_PREFIX);
}
