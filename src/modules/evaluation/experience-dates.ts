import { findTermOccurrences, isLetterspacedLine, normalizeForSearch, type NormalizedText } from "./text";
import type { Evidence } from "./types";

/**
 * Años de experiencia calculados a partir de los periodos con fechas de la
 * sección de experiencia del CV. Módulo puro y determinista: para el mismo
 * texto, los mismos términos y la misma fecha de referencia da el mismo
 * resultado.
 *
 * Se trabaja por LÍNEAS del texto original (la normalización de búsqueda
 * colapsa los saltos de línea). Las líneas en blanco se descartan antes de
 * contar posiciones, para que la heurística de entradas no dependa de cuántas
 * líneas vacías deje la extracción del PDF.
 *
 * Heurística de secciones: una línea corta (≤ 6 palabras) cuyo texto, sin
 * signos, es exactamente un encabezado de experiencia la abre. La cierran dos
 * clases de encabezado:
 *  - Fuertes (formación, estudios, cursos, idiomas, habilidades, conocimientos,
 *    referencias, datos/información, perfil, resumen…): coinciden por texto
 *    exacto o por su primera palabra, con o sin «:», y además cortan una entrada
 *    aunque la línea sea larga («Habilidades: Excel, …»).
 *  - Ambiguos (logros, proyectos, herramientas, tecnologías, software,
 *    informática): también aparecen DENTRO de un empleo («Logros:»,
 *    «Herramientas: SAP, Excel»), así que solo cierran como encabezado aislado,
 *    sin «:» ni contenido después.
 * «Funciones», «responsabilidades», «tareas» y «actividades» nunca cierran.
 * Una línea con un rango de fechas nunca es encabezado. No se usa «línea en
 * mayúsculas» (los cargos suelen ir así) ni «línea corta con :». Solo cuentan
 * los periodos dentro de una sección de experiencia; sin encabezado no hay
 * periodos.
 *
 * Heurística de entradas: cada línea con un rango de fechas L_i es una
 * entrada. Abarca desde S_i = max(E_{i-1}+1, L_i-2) (el cargo y la empresa
 * suelen ir 1-2 líneas arriba de la fecha) hasta E_i, la línea anterior al
 * título probable de la siguiente entrada (L_{i+1}-3, nunca menos que L_i), o
 * el fin de la sección, con un tope de 12 líneas tras la línea de fecha y
 * cortada ante una línea de cierre (ver abajo). Así incluye también la
 * descripción que va debajo sin absorber bloques posteriores.
 */

const MAX_QUOTES = 3;
const MIN_START_YEAR = 1950;
const MAX_DURATION_MONTHS = 50 * 12;
const MAX_HEADING_WORDS = 6;

const EXPERIENCE_HEADINGS = new Set([
  "experiencia",
  "experiencia laboral",
  "experiencia profesional",
  "trayectoria",
  "trayectoria laboral",
  "trayectoria profesional",
  "historial laboral",
  "experiencia de trabajo",
  "work experience",
  "professional experience",
  "employment history",
  "experience",
]);

// Primera palabra (normalizada) de un encabezado fuerte («Estudios realizados», «Información académica»…).
const STRONG_PREFIXES = new Set([
  "formacion", "estudios", "estudio", "educacion", "curso", "cursos", "capacitacion", "capacitaciones",
  "certificacion", "certificaciones", "idiomas", "habilidades", "competencias", "conocimientos", "referencias",
  "datos", "informacion", "otros", "especializacion", "especializaciones", "diplomado", "diplomados", "posgrado",
  "maestria", "publicaciones", "premios", "intereses", "voluntariado", "perfil", "resumen",
  "education", "skills", "certifications", "courses", "languages", "references", "profile", "summary",
]);

// Encabezados ambiguos: solo cierran aislados (sin «:» ni contenido después).
const AMBIGUOUS_PREFIXES = new Set(["logros", "proyectos", "herramientas", "tecnologias", "software", "informatica"]);

// Subtítulos propios de un empleo: nunca cierran ni cortan.
const NEVER_CLOSING = new Set(["funciones", "responsabilidades", "tareas", "actividades", "principales"]);

const MAX_ENTRY_LINES_AFTER_DATE = 12;

// Meses ya normalizados (minúsculas, sin tildes). Las abreviaturas llevan punto opcional.
const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  setiembre: 9, septiembre: 9, set: 9, sep: 9, sept: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};

const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const YEAR = String.raw`(?<!\d)((?:19|20)\d{2})(?!\d)`;
const PRESENT = String.raw`(?:a la fecha|a la actualidad|la fecha|la actualidad|actualidad|actual|presente|hoy|present|current|now)(?![\p{L}\p{N}])`;
// Año de dos dígitos: solo junto a un mes, nunca suelto («19» a secas es cualquier número).
const SHORT_YEAR = String.raw`(\d{2})(?!\d)`;
// Fecha con cinco formas:
//  1. mes con nombre + año («marzo 2019», «ene-2019»);
//  2. mes numérico (con día opcional: dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa) + año;
//  3. año solo;
//  4. mes con nombre + año de dos dígitos («ene-19», «Ene. 19», «Jan '19»);
//  5. mes numérico (con día opcional) + año de dos dígitos («01/19», «15/03/19»,
//     «05-18»). Con punto no: «3.50 - 4.20» puede ser un decimal.
// Los separadores numéricos no admiten espacios para no confundir «12 - 2019»
// con un rango. Las formas con año completo van primero en la alternancia.
const DATE_CORE = String.raw`(?:(?<![\p{L}\p{N}])(${MONTH_NAMES})\.?\s*[-/]?\s*,?\s*(?:de\s+|del\s+)?${YEAR}|(?<!\d)(?:(?:0?[1-9]|[12]\d|3[01])[/.\-])?(0?[1-9]|1[0-2])[/.\-]${YEAR}|${YEAR}|(?<![\p{L}\p{N}])(${MONTH_NAMES})(?:\.?\s*[-/'’]\s*|\.?\s+|\.)${SHORT_YEAR}|(?<!\d)(?:(?:0?[1-9]|[12]\d|3[01])[/\-])?(0?[1-9]|1[0-2])[/\-]${SHORT_YEAR})`;
/** Grupos de captura de cada `DATE_CORE` (ver `parseDate`). */
const DATE_GROUPS = 9;
/** Grupos del rango: inicio desde el 1, fin con fecha desde el 1 + DATE_GROUPS y, al final, el fin «en curso». */
const START_OFFSET = 1;
const END_OFFSET = START_OFFSET + DATE_GROUPS;
const PRESENT_GROUP = END_OFFSET + DATE_GROUPS;
// El inicio no puede ir pegado a otros dígitos ni a un patrón «dígito-guion» (números de
// teléfono, códigos) ni a una etiqueta de teléfono/documento: «Tel 987-2019 - 2025».
const START_GUARD = String.raw`(?<![\d\-/])(?<!(?:tel|telf|tlf|telefono|cel|celular|movil|phone|fax|ruc|dni|cod|codigo)\.?:?\s*)`;
// El fin no puede continuar con «-dígitos» (p. ej. 2019-2020-0045).
const END_GUARD = String.raw`(?![\d-]?\d)`;
const SEPARATOR = String.raw`(?:\s*[-–—]\s*|\s+(?:a|al|hasta|to|until)\s+)`;
const RANGE = new RegExp(
  String.raw`(?:(?<![\p{L}\p{N}])(?:desde|de|from)\s+)?${START_GUARD}${DATE_CORE}${SEPARATOR}(?:${DATE_CORE}${END_GUARD}|(${PRESENT}))`,
  "gu",
);

type Bounds = { earliest: number; latest: number };
type Period = {
  /** Intervalo más corto compatible con las fechas (índices de mes, ambos inclusive). */
  lo: [number, number];
  /** Intervalo más largo compatible con las fechas. */
  hi: [number, number];
};

export type ExperienceEstimate = {
  /** Años acumulados en el supuesto más corto (cota mínima). */
  minYears: number;
  /** Años acumulados en el supuesto más largo (cota máxima). */
  maxYears: number;
  /** Líneas literales del CV con las fechas usadas (máximo 3). */
  quotes: Evidence[];
};

type Line = { text: string; start: number; end: number; normalized: string; letterspaced: boolean };

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

function toLines(original: string): Line[] {
  const lines: Line[] = [];
  const pattern = /[^\r\n]+/g;
  for (const found of original.matchAll(pattern)) {
    const raw = found[0];
    const text = raw.trim();
    if (!text) continue;
    const start = found.index + raw.indexOf(text);
    lines.push({
      text,
      start,
      end: start + text.length,
      normalized: normalizeForSearch(text).text,
      letterspaced: isLetterspacedLine(text),
    });
  }
  return lines;
}

/**
 * Encabezados sin espacios, para las líneas que el PDF abrió letra por letra.
 * En esa extracción el hueco entre palabras es del mismo ancho que el de entre
 * letras, así que «E X P E R I E N C I A   L A B O R A L» llega con un solo
 * espacio en todos los huecos y se reconstruye como «experiencialaboral»: la
 * frontera de palabra no está en el fichero. Para un conjunto cerrado y
 * pequeño como este sí se puede comparar sin espacios, y es donde está el daño
 * de verdad: sin encabezado no hay sección de experiencia, y sin ella no se
 * calculan los años de nadie.
 */
const sinEspacios = (texto: string) => texto.replace(/ /g, "");
const EXPERIENCE_HEADINGS_JUNTOS = new Set([...EXPERIENCE_HEADINGS].map(sinEspacios));

/** Prefijo de un encabezado pegado a su resto («formacionacademica» → «formacion»). */
function prefijoPegado(clean: string, prefijos: Set<string>): string | null {
  for (const prefijo of prefijos) if (clean.startsWith(prefijo)) return prefijo;
  return null;
}

function headingKind(normalized: string, letterspaced: boolean): "experience" | "other" | null {
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_HEADING_WORDS) return null;
  // Una línea con un rango de fechas es contenido (p. ej. un cargo), no un encabezado.
  if (normalized.matchAll(RANGE).next().done === false) return null;
  const clean = normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (EXPERIENCE_HEADINGS.has(clean)) return "experience";
  // La comparación sin espacios se limita a las líneas espaciadas por el PDF:
  // en una línea normal, una sola palabra que empiece por «perfil» o «datos»
  // no es un encabezado y cerraría la sección antes de tiempo.
  if (letterspaced) {
    if (EXPERIENCE_HEADINGS_JUNTOS.has(clean)) return "experience";
    if (prefijoPegado(clean, NEVER_CLOSING) !== null) return null;
    if (prefijoPegado(clean, STRONG_PREFIXES) !== null) return "other";
    if (prefijoPegado(clean, AMBIGUOUS_PREFIXES) !== null && !normalized.includes(":")) return "other";
    return null;
  }
  const firstWord = clean.split(" ")[0] ?? "";
  if (NEVER_CLOSING.has(firstWord)) return null;
  if (STRONG_PREFIXES.has(firstWord)) return "other";
  if (AMBIGUOUS_PREFIXES.has(firstWord) && !normalized.includes(":")) return "other";
  return null;
}

/**
 * Línea que corta una entrada: un encabezado de cierre o una línea de la forma
 * «Habilidades: Excel, …» (palabra de cierre FUERTE + «:») aunque sea larga.
 */
function breaksEntry(line: Line): boolean {
  if (headingKind(line.normalized, line.letterspaced) === "other") return true;
  const first = line.normalized.match(/^(\p{L}+)\s*:/u)?.[1];
  return first !== undefined && STRONG_PREFIXES.has(first);
}

/** Rangos de líneas [primera, última] (sin el encabezado) de cada sección de experiencia. */
function experienceSections(lines: Line[]): Array<[number, number]> {
  const sections: Array<[number, number]> = [];
  let start: number | null = null;
  lines.forEach((line, index) => {
    const kind = headingKind(line.normalized, line.letterspaced);
    if (kind === null) return;
    if (start !== null && start <= index - 1) sections.push([start, index - 1]);
    start = kind === "experience" ? index + 1 : null;
  });
  if (start !== null && start <= lines.length - 1) sections.push([start, lines.length - 1]);
  return sections;
}

/**
 * Año de dos dígitos con pivote en el año de referencia: «19» es 2019 si no
 * pasa del año de referencia, y del siglo anterior si pasa («98» → 1998).
 */
function expandShortYear(twoDigits: string, referenceYear: number): number {
  const century = Math.floor(referenceYear / 100) * 100;
  const year = century + Number(twoDigits);
  return year <= referenceYear ? year : year - 100;
}

function parseDate(match: RegExpMatchArray, offset: number, referenceYear: number): { year: number; month: number | null } {
  const name = match[offset];
  if (name !== undefined) return { year: Number(match[offset + 1]), month: MONTHS[name]! };
  if (match[offset + 2] !== undefined) return { year: Number(match[offset + 3]), month: Number(match[offset + 2]) };
  if (match[offset + 4] !== undefined) return { year: Number(match[offset + 4]), month: null };
  const shortName = match[offset + 5];
  if (shortName !== undefined) return { year: expandShortYear(match[offset + 6]!, referenceYear), month: MONTHS[shortName]! };
  return { year: expandShortYear(match[offset + 8]!, referenceYear), month: Number(match[offset + 7]) };
}

/** Periodos válidos de una línea normalizada. */
export function parsePeriods(normalized: string, referenceDate: Date): Period[] {
  const referenceYear = referenceDate.getUTCFullYear();
  const reference = monthIndex(referenceYear, referenceDate.getUTCMonth() + 1);
  const periods: Period[] = [];
  for (const match of normalized.matchAll(RANGE)) {
    const from = parseDate(match, START_OFFSET, referenceYear);
    const present = match[PRESENT_GROUP] !== undefined;
    const to = present ? null : parseDate(match, END_OFFSET, referenceYear);
    if (from.year < MIN_START_YEAR) continue;

    const start: Bounds =
      from.month !== null
        ? { earliest: monthIndex(from.year, from.month), latest: monthIndex(from.year, from.month) }
        : { earliest: monthIndex(from.year, 1), latest: monthIndex(from.year, 12) };
    const end: Bounds =
      to === null
        ? { earliest: reference, latest: reference }
        : to.month !== null
          ? { earliest: monthIndex(to.year, to.month), latest: monthIndex(to.year, to.month) }
          : { earliest: monthIndex(to.year, 1), latest: monthIndex(to.year, 12) };

    if (start.earliest > reference) continue; // inicio posterior a la referencia
    if (end.latest < start.earliest) continue; // fin anterior al inicio

    const hiEnd = Math.min(end.latest, reference);
    const hi: [number, number] = [start.earliest, hiEnd];
    if (hi[1] - hi[0] + 1 > MAX_DURATION_MONTHS) continue;
    // Cota mínima: inicio lo más tarde y fin lo más pronto posibles, nunca menos de 1 mes.
    const loStart = Math.min(start.latest, hiEnd);
    const lo: [number, number] = [loStart, Math.max(loStart, Math.min(end.earliest, reference))];
    periods.push({ lo, hi });
  }
  return periods;
}

/** Une intervalos solapados y devuelve los meses totales. */
function unionMonths(intervals: Array<[number, number]>): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [from, to] of sorted) {
    if (current && from <= current[1]) {
      current[1] = Math.max(current[1], to);
    } else {
      if (current) total += current[1] - current[0] + 1;
      current = [from, to];
    }
  }
  if (current) total += current[1] - current[0] + 1;
  return total;
}

type Entry = { lineIndex: number; periods: Period[]; haystack: NormalizedText };

function sectionEntries(lines: Line[], [first, last]: [number, number], referenceDate: Date): Entry[] {
  const dated: Array<{ lineIndex: number; periods: Period[] }> = [];
  for (let i = first; i <= last; i++) {
    const periods = parsePeriods(lines[i]!.normalized, referenceDate);
    if (periods.length > 0) dated.push({ lineIndex: i, periods });
  }
  const entries: Entry[] = [];
  let previousEnd = first - 1;
  dated.forEach((item, position) => {
    const next = dated[position + 1];
    let lastLine = next ? Math.max(next.lineIndex - 3, item.lineIndex) : last;
    lastLine = Math.min(lastLine, item.lineIndex + MAX_ENTRY_LINES_AFTER_DATE);
    for (let i = item.lineIndex + 1; i <= lastLine; i++) {
      if (breaksEntry(lines[i]!)) {
        lastLine = i - 1;
        break;
      }
    }
    const firstLine = Math.max(previousEnd + 1, item.lineIndex - 2, first);
    const haystack = normalizeForSearch(
      lines
        .slice(firstLine, lastLine + 1)
        .map((line) => line.text)
        .join("\n"),
    );
    entries.push({ lineIndex: item.lineIndex, periods: item.periods, haystack });
    previousEnd = lastLine;
  });
  return entries;
}

/** Líneas, secciones y entradas del CV, calculadas una sola vez por evaluación. */
export type ExperienceIndex = { lines: Line[]; entries: Entry[] };

export function buildExperienceIndex(original: string, referenceDate: Date): ExperienceIndex {
  const lines = toLines(original);
  const entries = experienceSections(lines).flatMap((section) => sectionEntries(lines, section, referenceDate));
  return { lines, entries };
}

/**
 * Suma los periodos con fechas de la sección de experiencia cuyas entradas
 * mencionan alguno de los términos. Devuelve null si no hay periodos
 * atribuibles a esos términos.
 */
export function estimateFromIndex(index: ExperienceIndex, terms: string[]): ExperienceEstimate | null {
  const { lines } = index;
  const lo: Array<[number, number]> = [];
  const hi: Array<[number, number]> = [];
  const quoteLines: number[] = [];

  for (const entry of index.entries) {
    if (!terms.some((term) => findTermOccurrences(entry.haystack, term, 1).length > 0)) continue;
    for (const period of entry.periods) {
      lo.push(period.lo);
      hi.push(period.hi);
    }
    quoteLines.push(entry.lineIndex);
  }

  if (hi.length === 0) return null;
  const quotes = quoteLines.slice(0, MAX_QUOTES).map((i) => {
    const line = lines[i]!;
    return { quote: line.text, start: line.start, end: line.end };
  });
  return { minYears: unionMonths(lo) / 12, maxYears: unionMonths(hi) / 12, quotes };
}

export function estimateExperienceFromDates(
  original: string,
  terms: string[],
  referenceDate: Date,
): ExperienceEstimate | null {
  return estimateFromIndex(buildExperienceIndex(original, referenceDate), terms);
}

export type ImpossibleReason = "fin_antes_inicio" | "inicio_futuro";
export type ImpossibleRange = { quote: string; start: number; end: number; reason: ImpossibleReason };

/**
 * Rangos de fecha IMPOSIBLES dentro de la sección de experiencia: el fin es
 * anterior al inicio, o el inicio es posterior a hoy. Señal para verificar en
 * la entrevista (suele ser un error de tipeo), no un descarte.
 *
 * Es ADITIVA: reutiliza el mismo reconocedor (`RANGE`), el mismo análisis de
 * fecha (`parseDate`) y las mismas reglas de descarte que `parsePeriods`, sin
 * modificar el cálculo de años. Por eso no altera los bancos del motor. Solo se
 * mira la sección de experiencia (no fechas de cursos o certificaciones) y como
 * máximo una vez por línea.
 */
export function findImpossibleDateRanges(original: string, referenceDate: Date): ImpossibleRange[] {
  const referenceYear = referenceDate.getUTCFullYear();
  const reference = monthIndex(referenceYear, referenceDate.getUTCMonth() + 1);
  const lines = toLines(original);
  const result: ImpossibleRange[] = [];
  for (const [first, last] of experienceSections(lines)) {
    for (let i = first; i <= last; i++) {
      const line = lines[i]!;
      let flagged = false;
      for (const match of line.normalized.matchAll(RANGE)) {
        if (flagged) break;
        const from = parseDate(match, START_OFFSET, referenceYear);
        if (from.year < MIN_START_YEAR) continue;
        const startEarliest = from.month !== null ? monthIndex(from.year, from.month) : monthIndex(from.year, 1);
        let reason: ImpossibleReason | null = null;
        if (startEarliest > reference) {
          reason = "inicio_futuro";
        } else if (match[PRESENT_GROUP] === undefined) {
          // No está "en curso": hay una fecha de fin que comparar.
          const to = parseDate(match, END_OFFSET, referenceYear);
          const endLatest = to.month !== null ? monthIndex(to.year, to.month) : monthIndex(to.year, 12);
          if (endLatest < startEarliest) reason = "fin_antes_inicio";
        }
        if (reason) {
          result.push({ quote: line.text, start: line.start, end: line.end, reason });
          flagged = true;
        }
      }
    }
  }
  return result;
}
