import { normalizeForSearch } from "./text";

/**
 * CV que copia frases textuales del aviso de la vacante. Módulo puro y
 * determinista.
 *
 * Adaptar el CV a la vacante (resaltar lo pertinente, usar las palabras del
 * rubro) es legítimo y NO se marca. Lo que se marca es el copiar y pegar
 * literal de tramos largos de la descripción o las funciones del aviso: un
 * tramo copiado cuenta para el motor como si fuera experiencia propia.
 *
 * Solo produce una nota neutra para RRHH y una pista para la segunda opinión
 * con IA. No excluye texto, no cambia el puntaje y nunca descarta a nadie.
 *
 * Se compara contra la descripción y las funciones del aviso, no contra los
 * requisitos: es normal que el CV repita el nombre de un requisito.
 */

/** Palabras seguidas idénticas al aviso a partir de las cuales un tramo cuenta como copiado. */
export const MIN_COPIED_WORDS = 10;
/** Se avisa con dos tramos copiados o más… */
const MIN_FRAGMENTS = 2;
/**
 * …o con uno solo largo: una función entera del aviso suele tener 15-20
 * palabras. En los 73 CV legítimos de la base local, el tramo común más largo
 * con su aviso fue de 5 palabras.
 */
const LONG_FRAGMENT_WORDS = 15;
/** Un tramo copiado necesita palabras con contenido, no solo artículos y preposiciones. */
const MIN_CONTENT_WORDS = 5;
const CONTENT_WORD_LENGTH = 4;
const MAX_QUOTE = 140;

/** Inicio fijo de la nota; permite reconocerla entre las limitaciones guardadas. */
export const VACANCY_COPY_NOTE_PREFIX = "El CV repite frases textuales del aviso de la vacante";

export type CopiedPhrase = {
  /** Tramo literal del CV. */
  quote: string;
  start: number;
  end: number;
  /** Palabras del tramo. */
  words: number;
};

type Token = { word: string; start: number; end: number };

/** Palabras normalizadas (minúsculas, sin tildes) con su posición en el texto original. */
function tokenize(original: string): Token[] {
  const normalized = normalizeForSearch(original);
  const tokens: Token[] = [];
  for (const match of normalized.text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const first = match.index;
    const last = first + match[0].length - 1;
    tokens.push({ word: match[0], start: normalized.map[first]!, end: normalized.map[last]! + 1 });
  }
  return tokens;
}

/** Tramos del CV que coinciden palabra por palabra con el aviso (al menos `MIN_COPIED_WORDS` seguidas). */
export function findCopiedVacancyPhrases(cvText: string, vacancyText: string): CopiedPhrase[] {
  const vacancy = tokenize(vacancyText).map((t) => t.word);
  if (vacancy.length < MIN_COPIED_WORDS) return [];
  const shingles = new Set<string>();
  for (let i = 0; i + MIN_COPIED_WORDS <= vacancy.length; i++) {
    shingles.add(vacancy.slice(i, i + MIN_COPIED_WORDS).join(" "));
  }

  const cv = tokenize(cvText);
  const covered = new Array<boolean>(cv.length).fill(false);
  for (let i = 0; i + MIN_COPIED_WORDS <= cv.length; i++) {
    const key = cv
      .slice(i, i + MIN_COPIED_WORDS)
      .map((t) => t.word)
      .join(" ");
    if (shingles.has(key)) covered.fill(true, i, i + MIN_COPIED_WORDS);
  }

  const phrases: CopiedPhrase[] = [];
  let i = 0;
  while (i < cv.length) {
    if (!covered[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < cv.length && covered[j + 1]) j++;
    const run = cv.slice(i, j + 1);
    const contentWords = run.filter((t) => t.word.length >= CONTENT_WORD_LENGTH).length;
    if (contentWords >= MIN_CONTENT_WORDS) {
      const start = run[0]!.start;
      const end = run[run.length - 1]!.end;
      phrases.push({ quote: cvText.slice(start, end), start, end, words: run.length });
    }
    i = j + 1;
  }
  return phrases;
}

/** ¿Hay copia suficiente como para avisar? */
export function isVacancyCopy(phrases: CopiedPhrase[]): boolean {
  return phrases.length >= MIN_FRAGMENTS || phrases.some((p) => p.words >= LONG_FRAGMENT_WORDS);
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > MAX_QUOTE ? `${clean.slice(0, MAX_QUOTE - 1)}…` : clean;
}

/** El hallazgo, sin consejos: lo comparten la nota de RRHH y la pista de la IA. */
function finding(phrases: CopiedPhrase[]): string {
  const words = phrases.reduce((sum, p) => sum + p.words, 0);
  const longest = phrases.reduce((a, b) => (b.words > a.words ? b : a));
  const count = phrases.length === 1 ? "1 tramo" : `${phrases.length} tramos`;
  return `${VACANCY_COPY_NOTE_PREFIX} (${count}, ${words} palabras), por ejemplo: «${clip(longest.quote)}»`;
}

/** Nota neutra para las limitaciones de la evaluación (vacía si no hay copia suficiente). */
export function describeVacancyCopy(phrases: CopiedPhrase[]): string[] {
  if (!isVacancyCopy(phrases)) return [];
  return [
    `${finding(phrases)}. Adaptar el CV a la vacante es habitual, pero lo copiado del aviso no muestra por sí solo experiencia propia: conviene confirmar en la entrevista que realizó esas funciones. No es un motivo de descarte.`,
  ];
}

/** Pista para la segunda opinión con IA (null si no hay copia suficiente). */
export function vacancyCopyHint(phrases: CopiedPhrase[]): string | null {
  if (!isVacancyCopy(phrases)) return null;
  return `${finding(phrases)}. Lo copiado del aviso no acredita por sí solo: acredita un requisito solo si el CV lo respalda con experiencia propia (cargo, empresa, fechas o logros); si no, déjalo como pendiente_verificacion.`;
}

/** Texto del aviso con el que se compara: descripción y funciones. */
export function vacancyAdText(vacancy: { description?: string | null; responsibilities?: string | null }): string {
  return [vacancy.description, vacancy.responsibilities].filter((part): part is string => Boolean(part?.trim())).join("\n");
}
