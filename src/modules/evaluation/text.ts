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
