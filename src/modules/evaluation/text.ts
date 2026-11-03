/**
 * Utilidades de búsqueda de texto insensibles a mayúsculas, tildes y espacios,
 * que conservan la correspondencia con el texto original para poder citar
 * evidencias literales.
 */

export type NormalizedText = {
  /** Texto en minúsculas, sin tildes y con espacios colapsados. */
  text: string;
  /** map[i] = índice en el texto original del carácter normalizado i. */
  map: number[];
};

const WHITESPACE = /\s/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function normalizeChar(char: string): string {
  return char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function normalizeForSearch(original: string): NormalizedText {
  // Acumula en arreglos y usa un indicador de espacio: concatenar y consultar
  // `endsWith` sobre una cadena creciente es cuadrático en textos largos.
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < original.length; i++) {
    const char = original[i]!;
    if (WHITESPACE.test(char)) {
      if (chars.length > 0 && !lastWasSpace) {
        chars.push(" ");
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    for (const normalized of normalizeChar(char)) {
      chars.push(normalized);
      map.push(i);
      lastWasSpace = normalized === " ";
    }
  }
  if (lastWasSpace) {
    chars.pop();
    map.pop();
  }
  return { text: chars.join(""), map };
}

export function normalizeTerm(term: string): string {
  return normalizeForSearch(term).text;
}

export type Match = { start: number; end: number };

/**
 * Busca un término respetando límites de palabra en los extremos alfanuméricos
 * (así "sql" no coincide dentro de "mysqlx", pero ".net" o "c#" sí funcionan).
 */
export function findTermOccurrences(haystack: NormalizedText, term: string, limit = 20): Match[] {
  const needle = normalizeTerm(term);
  if (!needle) return [];
  const matches: Match[] = [];
  const checkStart = WORD_CHAR.test(needle[0]!);
  const checkEnd = WORD_CHAR.test(needle[needle.length - 1]!);
  let from = 0;
  while (matches.length < limit) {
    const index = haystack.text.indexOf(needle, from);
    if (index === -1) break;
    const end = index + needle.length;
    const before = index > 0 ? haystack.text[index - 1]! : " ";
    const after = end < haystack.text.length ? haystack.text[end]! : " ";
    const startOk = !checkStart || !WORD_CHAR.test(before);
    const endOk = !checkEnd || !WORD_CHAR.test(after);
    if (startOk && endOk) matches.push({ start: index, end });
    from = index + 1;
  }
  return matches;
}

/** Devuelve un extracto del texto original alrededor de una coincidencia. */
export function excerpt(
  original: string,
  haystack: NormalizedText,
  match: Match,
  radius = 70,
): { quote: string; start: number; end: number } {
  const start = haystack.map[match.start]!;
  const end = haystack.map[match.end - 1]! + 1;
  let from = Math.max(0, start - radius);
  let to = Math.min(original.length, end + radius);
  // Ajusta a límites de palabra para no cortar palabras.
  while (from > 0 && from < start && !WHITESPACE.test(original[from - 1]!)) from++;
  while (to < original.length && to > end && !WHITESPACE.test(original[to]!)) to--;
  const body = original.slice(from, to).replace(/\s+/g, " ").trim();
  const quote = `${from > 0 ? "…" : ""}${body}${to < original.length ? "…" : ""}`;
  return { quote, start, end };
}

/** Normaliza espacios para comparar citas con el texto fuente. */
export function containsQuote(source: NormalizedText, quote: string): boolean {
  const needle = normalizeTerm(quote.replace(/^…|…$/g, ""));
  return needle.length >= 3 && source.text.includes(needle);
}

// ───────── Oraciones y variantes de palabras ─────────

const SENTENCE_BREAK = /[!?;\n\r•·|]/;
// Abreviaturas frecuentes en CV: el punto que las cierra no termina la oración.
const ABBREVIATION = /(?:^|[\s(])(?:sr|sra|srta|ing|lic|dr|dra|mg|mba|cpc|s\.a|s\.a\.c|s\.r\.l|etc|av|jr|n[°º])$/i;

function isSentenceEnd(original: string, index: number): boolean {
  const char = original[index]!;
  if (SENTENCE_BREAK.test(char)) return true;
  if (char !== ".") return false;
  const next = original[index + 1];
  // «3.5», «.NET», «www.sitio.com»: el punto va pegado al texto siguiente.
  if (next !== undefined && !/\s/.test(next)) return false;
  return !ABBREVIATION.test(original.slice(Math.max(0, index - 12), index));
}

/** Límites [from, to) de la oración o línea del texto original que contiene el rango dado. */
export function sentenceBounds(original: string, start: number, end: number): { from: number; to: number } {
  let from = start;
  while (from > 0 && !isSentenceEnd(original, from - 1)) from--;
  let to = end;
  while (to < original.length && !isSentenceEnd(original, to)) to++;
  if (to < original.length && original[to] === ".") to++;
  return { from, to };
}

/**
 * Extracto con la oración completa donde aparece la coincidencia. Si la
 * oración es muy larga, se recorta alrededor de la coincidencia.
 */
export function sentenceExcerpt(
  original: string,
  haystack: NormalizedText,
  match: Match,
  maxLength = 240,
): { quote: string; start: number; end: number } {
  const start = haystack.map[match.start]!;
  const end = haystack.map[match.end - 1]! + 1;
  const { from, to } = sentenceBounds(original, start, end);
  const body = original.slice(from, to).replace(/\s+/g, " ").trim();
  if (body.length === 0 || body.length > maxLength) return excerpt(original, haystack, match, 90);
  const quote = `${from > 0 && !isSentenceEnd(original, from - 1) ? "…" : ""}${body}`;
  return { quote, start, end };
}

/**
 * Formas equivalentes de un término: singular/plural y género (o/a, or/ora).
 * Solo flexión, nunca derivación: «contable» ≠ «contador», para no dar por
 * cumplido lo que el CV no dice.
 */
export function termVariants(term: string): string[] {
  const base = normalizeTerm(term);
  if (!base) return [];
  const words = base.split(" ");
  const toggle = (word: string): string[] => {
    if (!/^\p{L}{4,}$/u.test(word)) return [word];
    const forms = new Set<string>([word]);
    if (word.endsWith("es") && word.length >= 6) forms.add(word.slice(0, -2));
    if (word.endsWith("s") && word.length >= 5) forms.add(word.slice(0, -1));
    if (!word.endsWith("s")) {
      forms.add(`${word}s`);
      if (/[bcdfghjklmnpqrtvwxyz]$/.test(word)) forms.add(`${word}es`);
    }
    for (const form of [...forms]) {
      if (form.endsWith("o")) forms.add(`${form.slice(0, -1)}a`);
      else if (form.endsWith("a")) forms.add(`${form.slice(0, -1)}o`);
      else if (form.endsWith("os")) forms.add(`${form.slice(0, -2)}as`);
      else if (form.endsWith("as")) forms.add(`${form.slice(0, -2)}os`);
      else if (form.endsWith("or")) forms.add(`${form}a`);
    }
    return [...forms];
  };
  if (words.length === 1) return toggle(words[0]!);
  // Varias palabras: cada palabra puede ir en singular o plural (sin cambiar el género), hasta 16 combinaciones.
  const options = words.map((w) => toggle(w).filter((form) => form === w || form === `${w}s` || form === `${w}es` || form === w.replace(/e?s$/, "")));
  let variants = new Set<string>([""]);
  for (const forms of options) {
    const next = new Set<string>();
    for (const prefix of variants) for (const form of forms) next.add(prefix ? `${prefix} ${form}` : form);
    variants = next;
    if (variants.size > 16) break;
  }
  variants.add(base);
  return [...variants];
}

/** Antes de la coincidencia, en su misma oración, hay una negación («sin experiencia en…»). */
export function isNegatedMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const start = haystack.map[match.start]!;
  const { from } = sentenceBounds(original, start, start + 1);
  const before = normalizeForSearch(original.slice(from, start)).text;
  return /(?:^|\s)(?:sin|no|ni|nunca|ningun[oa]?|carezco|carece|falta de)\s+(?!solo\b|solamente\b|unicamente\b)(?:[\p{L}\p{N}]+\s+){0,3}$/u.test(`${before} `);
}

/** Antes de la coincidencia, en su oración, hay un deseo o interés («interés en…», «busco…»): no es experiencia. */
export function isAspirationalMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const start = haystack.map[match.start]!;
  const { from } = sentenceBounds(original, start, start + 1);
  const before = normalizeForSearch(original.slice(from, start)).text;
  return /(?:interes en|interesad[oa] en|interes por|busco|aspiro|deseo|objetivo|me gustaria|ganas de|quiero)/.test(before);
}
