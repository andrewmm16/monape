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
  /** Texto de partida, para comprobar mayúsculas donde la forma importa. */
  original: string;
};

const WHITESPACE = /\s/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
// Caracteres invisibles que la extracción de PDF deja dentro de las palabras
// (guion suave, marcas de ancho cero). No deben romper una coincidencia.
const INVISIBLE = /[­​-‍⁠﻿]/;
const HYPHEN = /[-‐‑]/;
// Palabra partida al final de la línea («contabi-\nlidad»). Solo se une si al
// otro lado hay una letra: así «2019-\n2020» sigue siendo un rango de años.
const LINE_HYPHEN = /^[^\S\r\n]*\r?\n\s*(?=\p{L})/u;

/**
 * Algunos PDF abren los títulos letra por letra: «C O N T A B I L I D A D
 * G E N E R A L». Lo que salva el caso es que el espaciado no es uniforme:
 * dentro de una palabra las letras van separadas por un espacio y entre
 * palabras por dos o más. Hay que leerlo antes de colapsar los espacios, porque
 * al colapsarlos esa diferencia desaparece y ya no se puede distinguir
 * «contabilidad general» de «contabilidadgeneral» (y la búsqueda exige límites
 * de palabra en los extremos, así que la segunda forma no coincidiría con nada).
 *
 * Se decide por línea, no por documento: lo habitual es que el defecto afecte
 * solo a los encabezados. Y se exige que la línea sea mayoritariamente de
 * letras sueltas, para no tocar la prosa normal, donde «y», «o», «e», «u» y «a»
 * son palabras de una letra legítimas.
 */
const LETTERSPACED_MIN_SINGLES = 4;
const LETTERSPACED_MIN_SHARE = 0.6;
/** Condición necesaria para que haya algo que reconstruir. Descarta los CV sanos en una pasada nativa. */
const LETTERSPACED_HINT = /(?:^|[^\S\r\n])\p{L}[^\S\r\n]\p{L}[^\S\r\n]\p{L}[^\S\r\n]\p{L}(?![\p{L}\p{N}])/u;

function isLineBreak(char: string): boolean {
  return char === "\n" || char === "\r";
}

/** Recorre los tokens de original[from, to) entregando el rango de cada uno. */
function forEachToken(original: string, from: number, to: number, visit: (start: number, end: number) => void): void {
  let i = from;
  while (i < to) {
    while (i < to && WHITESPACE.test(original[i]!)) i++;
    if (i >= to) return;
    const start = i;
    while (i < to && !WHITESPACE.test(original[i]!)) i++;
    visit(start, i);
  }
}

function isSingleLetter(original: string, start: number, end: number): boolean {
  return end - start === 1 && /\p{L}/u.test(original[start]!);
}

function isLetterspacedRange(original: string, from: number, to: number): boolean {
  let tokens = 0;
  let singles = 0;
  forEachToken(original, from, to, (start, end) => {
    tokens++;
    if (isSingleLetter(original, start, end)) singles++;
  });
  return singles >= LETTERSPACED_MIN_SINGLES && singles >= tokens * LETTERSPACED_MIN_SHARE;
}

/**
 * La línea viene escrita letra por letra por el PDF. Hace falta saberlo fuera
 * de aquí porque la reconstrucción tiene un límite insalvable: cuando la
 * extracción deja un solo espacio también entre palabras («E X P E R I E N C I
 * A   L A B O R A L» llega como un único espacio en todos los huecos), la
 * frontera de palabra no está en el fichero y no hay nada que recuperar. Quien
 * compare contra un conjunto cerrado de términos —los encabezados de sección—
 * puede entonces comparar sin espacios, y solo debe hacerlo en estas líneas.
 */
export function isLetterspacedLine(line: string): boolean {
  return isLetterspacedRange(line, 0, line.length);
}

/**
 * Marca con 1 los espacios que separan letras de una misma palabra espaciada.
 * Devuelve null —el caso normal— si el texto no tiene ninguna.
 */
function letterspacedGaps(original: string): Uint8Array | null {
  if (!LETTERSPACED_HINT.test(original)) return null;
  let gaps: Uint8Array | null = null;
  let lineStart = 0;
  for (let i = 0; i <= original.length; i++) {
    if (i < original.length && !isLineBreak(original[i]!)) continue;
    if (i > lineStart) {
      if (isLetterspacedRange(original, lineStart, i)) {
        const marcas = (gaps ??= new Uint8Array(original.length));
        let previoFin = -1;
        let previoSuelto = false;
        forEachToken(original, lineStart, i, (start, end) => {
          const suelto = isSingleLetter(original, start, end);
          // Un solo espacio entre dos letras sueltas: separa letras, no
          // palabras. Dos o más se conservan como frontera de palabra.
          if (suelto && previoSuelto && start - previoFin === 1) marcas[previoFin] = 1;
          previoFin = end;
          previoSuelto = suelto;
        });
      }
    }
    lineStart = i + 1;
  }
  return gaps;
}

function normalizeChar(char: string): string {
  return char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function normalizeForSearch(original: string): NormalizedText {
  // Acumula en arreglos y usa un indicador de espacio: concatenar y consultar
  // `endsWith` sobre una cadena creciente es cuadrático en textos largos.
  const chars: string[] = [];
  const map: number[] = [];
  const letterGaps = letterspacedGaps(original);
  let lastWasSpace = false;
  for (let i = 0; i < original.length; i++) {
    const char = original[i]!;
    if (INVISIBLE.test(char)) continue;
    // Espacio interior de una palabra que el PDF abrió letra por letra.
    if (letterGaps !== null && letterGaps[i] === 1) continue;
    // Guion de corte de línea: se descarta y la palabra queda unida.
    if (HYPHEN.test(char) && chars.length > 0 && WORD_CHAR.test(chars[chars.length - 1]!)) {
      const corte = LINE_HYPHEN.exec(original.slice(i + 1));
      if (corte) {
        i += corte[0].length;
        continue;
      }
    }
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
  return { text: chars.join(""), map, original };
}

export function normalizeTerm(term: string): string {
  return normalizeForSearch(term).text;
}

export type Match = { start: number; end: number };

/** Longitud alfanumérica a partir de la cual el término ya no es ambiguo. */
export const SHORT_TERM_MAX = 2;

/**
 * Una sigla de uno o dos caracteres choca con palabras corrientes del español:
 * el término «SI» (Sistemas de Información) coincidiría con el «Si» de «Si bien
 * no manejo Excel». En esos términos la forma importa: solo cuentan si en el CV
 * están escritos como sigla (todas sus letras en mayúscula) o exactamente igual
 * que en el requisito, que es como siguen funcionando «B2», «Go» o «C#».
 */
function shortTermMatches(occurrence: string, term: string): boolean {
  if (occurrence === term.trim()) return true;
  const letters = [...occurrence].filter((char) => /\p{L}/u.test(char));
  return letters.length > 0 && letters.every((char) => char === char.toUpperCase() && char !== char.toLowerCase());
}

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
  const isShort = needle.replace(/[^\p{L}\p{N}]/gu, "").length <= SHORT_TERM_MAX;
  let from = 0;
  while (matches.length < limit) {
    const index = haystack.text.indexOf(needle, from);
    if (index === -1) break;
    const end = index + needle.length;
    const before = index > 0 ? haystack.text[index - 1]! : " ";
    const after = end < haystack.text.length ? haystack.text[end]! : " ";
    const startOk = !checkStart || !WORD_CHAR.test(before);
    const endOk = !checkEnd || !WORD_CHAR.test(after);
    const shortOk =
      !isShort || shortTermMatches(haystack.original.slice(haystack.map[index]!, haystack.map[end - 1]! + 1), term);
    if (startOk && endOk && shortOk) matches.push({ start: index, end });
    from = index + 1;
  }
  return matches;
}

/**
 * Palabras clave con palabras intercaladas (reglas-v14, banco ciego del
 * 19/11/2026): «Negociación anual con transportistas y proveedores» contiene
 * «Negociación con proveedores». En el mismo orden y en la misma frase:
 *  - tras una palabra con contenido, hasta 2 palabras que la modifican
 *    («Atención telefónica al cliente», «Gestión integral de planillas»);
 *  - tras una preposición o un artículo, solo un artículo y una coordinación
 *    («con transportistas y proveedores», «de cobranzas y planillas», «de la
 *    obra»): así «Supervisor de seguridad en obra» NO es «Supervisor de obra».
 * Nunca con una negación o un nivel en medio («experiencia nula en ventas»,
 * «manejo básico de…»), ni para palabras clave que llevan un nivel («Excel
 * avanzado»: el nivel lo juzga la escalera) o de una sola palabra. Como mucho
 * 3 palabras intercaladas en total.
 */
const LOOSE_FUNCTION_WORDS = new Set(["de", "del", "la", "el", "los", "las", "al", "a", "en", "con", "para", "por", "y", "e", "o", "u"]);
const LOOSE_ARTICLE = "(?:el|la|los|las|un|una|su|sus)";
const LOOSE_BLOCKED = "no|sin|nunca|ni|nul[oa]s?|poc[oa]s?|escas[oa]s?|limitad[oa]s?|basic[oa]s?|nociones|inicial";
const LOOSE_LEVEL_IN_TERM = /(?<![\p{L}\p{N}])(?:basic[oa]s?|intermedi[oa]s?|avanzad[oa]s?|nociones|experto|experta|nivel|usuario|[abc][12])(?![\p{L}\p{N}])/u;
const LOOSE_GAP_WORD = `(?!(?:${LOOSE_BLOCKED})(?![\\p{L}\\p{N}]))[\\p{L}\\p{N}]+`;
const MAX_LOOSE_EXTRA_WORDS = 3;

export function findLooseTermOccurrences(haystack: NormalizedText, term: string, limit = 20): Match[] {
  const needle = normalizeTerm(term);
  const words = needle.split(" ").filter(Boolean);
  if (words.length < 2 || words.filter((w) => w.length >= 3).length < 2) return [];
  if (LOOSE_LEVEL_IN_TERM.test(needle) || words.some((w) => !/^[\p{L}\p{N}]+$/u.test(w))) return [];
  let source = `(?<![\\p{L}\\p{N}])${words[0]}`;
  for (let i = 1; i < words.length; i++) {
    const gap = LOOSE_FUNCTION_WORDS.has(words[i - 1]!)
      ? `(?: ${LOOSE_ARTICLE})?(?: ${LOOSE_GAP_WORD},?(?: ${LOOSE_GAP_WORD},?)? (?:y|e|o|u))?`
      : `(?: ${LOOSE_GAP_WORD}){0,2}`;
    source += `${gap} ${words[i]}`;
  }
  const pattern = new RegExp(`${source}(?![\\p{L}\\p{N}])`, "gu");
  const matches: Match[] = [];
  for (const found of haystack.text.matchAll(pattern)) {
    const extra = found[0].split(" ").length - words.length;
    if (extra > MAX_LOOSE_EXTRA_WORDS) continue;
    matches.push({ start: found.index, end: found.index + found[0].length });
    if (matches.length >= limit) break;
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

const HORIZONTAL_SPACE = /[^\S\r\n]/;
/** Lo que puede quedar al final de una línea que continúa: texto, no cierre. */
const CONTINUES = /[\p{L}\p{N},)"'»-]/u;

/** Extensión del salto de línea que contiene `index`, tratando «\r\n» como uno. */
function lineBreakSpan(original: string, index: number): { from: number; to: number } {
  const from = original[index] === "\n" && original[index - 1] === "\r" ? index - 1 : index;
  const to = original[index] === "\r" && original[index + 1] === "\n" ? index + 2 : index + 1;
  return { from, to };
}

/**
 * El salto de línea solo parte la línea, no la frase. En un PDF la prosa se
 * corta por el ancho de la hoja, y «… al personal. No cuento⏎con experiencia
 * en planillas» es UNA frase: tratar ese salto como fin de oración dejaba la
 * negación en la línea anterior, fuera del alcance de la regla, y el motor
 * acreditaba justo lo que el candidato decía no tener. Solo se ve con PDF
 * reales; un texto escrito a mano en un test nunca se parte así.
 *
 * Es continuación cuando lo que precede al salto no cierra la frase (ni «.»,
 * «:», «;», «!», «?», ni viñeta) y lo que sigue abre en minúscula. Una entrada
 * nueva de un CV empieza en mayúscula, con viñeta o tras un punto, y una línea
 * en blanco deja un salto delante: todas esas siguen cortando.
 */
function isLineWrap(original: string, index: number): boolean {
  const { from, to } = lineBreakSpan(original, index);
  let before = from - 1;
  while (before >= 0 && HORIZONTAL_SPACE.test(original[before]!)) before--;
  if (before < 0 || !CONTINUES.test(original[before]!)) return false;
  let after = to;
  while (after < original.length && HORIZONTAL_SPACE.test(original[after]!)) after++;
  return after < original.length && /\p{Ll}/u.test(original[after]!);
}

function isSentenceEnd(original: string, index: number): boolean {
  const char = original[index]!;
  if (char === "\n" || char === "\r") return !isLineWrap(original, index);
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
  // Varias palabras: cada palabra puede ir en singular o plural, hasta 16 combinaciones por forma.
  const numberCombos = (ws: string[]): Set<string> => {
    const options = ws.map((w) => toggle(w).filter((form) => form === w || form === `${w}s` || form === `${w}es` || form === w.replace(/e?s$/, "")));
    let combos = new Set<string>([""]);
    for (const forms of options) {
      const next = new Set<string>();
      for (const prefix of combos) for (const form of forms) next.add(prefix ? `${prefix} ${form}` : form);
      combos = next;
      if (combos.size > 16) break;
    }
    return combos;
  };
  const variants = numberCombos(words);
  // Y el femenino de toda la frase a la vez («ingeniero sanitario» → «ingeniera sanitaria»).
  const feminine = feminineHead(words);
  if (feminine) for (const form of numberCombos(feminine)) variants.add(form);
  variants.add(base);
  return [...variants];
}

/** Palabras que cierran el núcleo de un término: lo que sigue es su complemento («licenciado en administración»). */
const HEAD_BREAK = new Set(["de", "del", "en", "con", "para", "por", "y", "e", "o", "u", "a", "al", "la", "el", "las", "los", "sin", "contra"]);

/**
 * Femenino concordado del núcleo de un término de varias palabras: cambia a la vez
 * cada palabra masculina (-o, -os, -or, -ores) hasta el primer conector, para que
 * «ingeniero sanitario» encuentre «ingeniera sanitaria» y «licenciado en
 * administración» encuentre «licenciada en administración». Solo de masculino a
 * femenino: al revés, «baja tensión» pasaría a «bajo tensión» y acreditaría «trabajo
 * bajo tensión». Devuelve `null` si no hay nada que cambiar.
 */
function feminineHead(words: string[]): string[] | null {
  let changed = false;
  let inHead = true;
  const result = words.map((word) => {
    if (!inHead) return word;
    if (HEAD_BREAK.has(word)) {
      inHead = false;
      return word;
    }
    if (!/^\p{L}{4,}$/u.test(word)) return word;
    let form = word;
    if (word.endsWith("ores")) form = `${word.slice(0, -2)}as`;
    else if (word.endsWith("os")) form = `${word.slice(0, -2)}as`;
    else if (word.endsWith("o")) form = `${word.slice(0, -1)}a`;
    else if (word.endsWith("or")) form = `${word}a`;
    if (form !== word) changed = true;
    return form;
  });
  return changed ? result : null;
}

/**
 * Negación acotada a su propia proposición. La ventana de palabras sola no
 * sirve: «no cuento con experiencia en Concar» pone cuatro palabras entre la
 * negación y el término, así que una ventana corta se lo pierde, y una ventana
 * larga empieza a negar lo que no debe («no es un problema, manejo Concar»).
 * La solución es cortar en el último cambio de proposición —coma, punto y
 * coma, dos puntos, paréntesis, «pero», «aunque»— y ya dentro de ella admitir
 * una ventana amplia.
 *
 * «y» y «o» no cortan a propósito: «no manejo Concar y Excel» niega los dos.
 */
const NEGATION =
  /(?:^|\s)(?:sin|no|ni|nunca|ningun[oa]?|nul[oa]s?|carezco|carece|carecemos|falta de)\s+(?!solo\b|solamente\b|unicamente\b)(?:[\p{L}\p{N}]+\s+){0,5}$/u;
const CLAUSE_BREAK = /[,;:()[\]]|\s(?:pero|aunque|sin embargo|salvo|excepto)\s/giu;

/** Última proposición de `before`: desde el último corte hasta el final. */
function clauseTail(before: string): string {
  CLAUSE_BREAK.lastIndex = 0;
  let desde = 0;
  for (let hallado = CLAUSE_BREAK.exec(before); hallado !== null; hallado = CLAUSE_BREAK.exec(before)) {
    desde = hallado.index + hallado[0].length;
  }
  return before.slice(desde);
}

/** Antes de la coincidencia, en su misma proposición, hay una negación («sin experiencia en…»). */
export function isNegatedMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const start = haystack.map[match.start]!;
  const { from } = sentenceBounds(original, start, start + 1);
  const before = normalizeForSearch(original.slice(from, start)).text;
  return NEGATION.test(`${clauseTail(before)} `);
}

/**
 * La coincidencia está dentro de un correo o un enlace: «sap@miempresa.com» o
 * «concar.com.pe/mi-perfil» mencionan el término sin decir nada de que la
 * persona lo maneje. Se mira el token completo que la contiene, no la oración.
 */
const LINK_TOKEN = /@|:\/\/|^www\.|\.(?:com|net|org|pe|edu|gob|gov|io|co|es|info|biz)\b/;

export function isLinkMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const start = haystack.map[match.start]!;
  const end = haystack.map[match.end - 1]! + 1;
  let from = start;
  while (from > 0 && !WHITESPACE.test(original[from - 1]!)) from--;
  let to = end;
  while (to < original.length && !WHITESPACE.test(original[to]!)) to++;
  return LINK_TOKEN.test(original.slice(from, to).toLowerCase());
}

/**
 * Sujeto que no es el candidato al principio de la frase: lo que sigue es de
 * otro. «Mi equipo utilizaba Concar» o «La empresa utiliza SAP» no demuestran
 * que la persona lo maneje.
 *
 * Es deliberadamente estrecho —exige determinante y que el sujeto abra la
 * frase— porque el lenguaje de un CV pone a terceros por todas partes sin
 * dejar de hablar del candidato: «Implementé SAP en la empresa», «Capacité al
 * equipo en Concar», «Reduje los errores del equipo con Excel». Esas tienen que
 * seguir acreditando, y el banco legítimo las vigila.
 */
const THIRD_PARTY_SUBJECT =
  /^[-•·*\s]*(?:mis?|el|la|los|las|nuestr[oa]s?)\s+(?:equipos?|empresas?|organizacion|compania|areas?|departamento|jefatura|gerencia|jefes?|jefa|gerentes?|supervisor[ae]?s?|clientes?|proveedor(?:es)?|institucion|personal|sedes?)\b/;
/** «Mi equipo y yo implementamos SAP»: el candidato se incluye. */
const FIRST_PERSON = /(?:^|\s)yo(?:\s|$)/;

export function isThirdPartyMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const start = haystack.map[match.start]!;
  const { from } = sentenceBounds(original, start, start + 1);
  const before = normalizeForSearch(original.slice(from, start)).text;
  return THIRD_PARTY_SUBJECT.test(before) && !FIRST_PERSON.test(before);
}

// reglas-v11: también «me interesa…» y la intención futura («próximamente me
// certificaré en SAP», «planeo aprender Power BI»): no es experiencia todavía.
const WISH_BEFORE =
  /(?:interes en|interesad[oa] en|interes por|busco|aspiro|deseo|objetivo|me gustaria|ganas de|quiero|\bme interesa|\bproximamente\b|\bplaneo\b|\bpienso\b|\ba futuro\b|\ben el futuro\b)/;
/**
 * Deseo expresado DESPUÉS del término, en una oración de relativo que cuelga de
 * él: «cursos de Concar que planeo tomar». Solo cuentan los verbos de adquirir
 * («tomar», «aprender», «cursar»): «Excel, que quiero perfeccionar» supone que
 * ya lo usa y tiene que seguir acreditando.
 */
const WISH_AFTER =
  /^[^.;!?\n]{0,40}\bque\s+(?:planeo|pienso|quiero|deseo|espero|pretendo|me gustaria)\s+(?:tomar|llevar|cursar|estudiar|aprender|iniciar|empezar|certificarme|capacitarme|comenzar)\b/;

/** En la oración de la coincidencia hay un deseo o interés («interés en…», «busco…»): no es experiencia. */
export function isAspirationalMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const start = haystack.map[match.start]!;
  const end = haystack.map[match.end - 1]! + 1;
  const { from, to } = sentenceBounds(original, start, start + 1);
  const before = normalizeForSearch(original.slice(from, start)).text;
  if (WISH_BEFORE.test(before)) return true;
  return WISH_AFTER.test(normalizeForSearch(original.slice(end, to)).text);
}

/** Línea del texto original que contiene la posición `index`. */
function lineAround(original: string, index: number): { from: number; to: number } {
  const from = original.lastIndexOf("\n", index - 1) + 1;
  const next = original.indexOf("\n", index);
  return { from, to: next === -1 ? original.length : next };
}

/**
 * Forma jurídica al final de un nombre de empresa (Perú y comunes): S.A.C.,
 * S.A.A., S.A., E.I.R.L., S.R.L., S.A.S., Ltda., Inc., Corp., LLC.
 */
const COMPANY_SUFFIX = /^(?:s\.?\s?a\.?\s?c\.?|s\.?\s?a\.?\s?a\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|e\.?\s?i\.?\s?r\.?\s?l\.?|s\.?\s?r\.?\s?l\.?|ltda\.?|inc\.?|corp\.?|llc)(?=$|[\s,;:)(\]|/-])/i;
/** Palabra de un nombre propio (con mayúscula inicial) o conector dentro de un nombre. */
const NAME_WORD = /^(?:\p{Lu}[\p{L}\p{N}.&'-]*|de|del|y|&)$/u;

/**
 * El término forma parte del NOMBRE DE UNA EMPRESA (reglas-v11): «Recepcionista en
 * SAP Perú S.A.C.» no dice que la persona maneje SAP. Se reconoce porque tras el
 * término, en la misma línea, solo hay palabras con mayúscula y luego una forma
 * jurídica. «Manejo de SAP en Alicorp S.A.A.» no cuenta: «en» corta el nombre.
 */
export function isCompanyNameMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const end = haystack.map[match.end - 1]! + 1;
  const { to } = lineAround(original, end);
  const rest = original.slice(end, Math.min(to, end + 60));
  const words = rest.split(/\s+/).filter((w) => w !== "");
  // Como mucho dos palabras de nombre entre el término y la forma jurídica: así un
  // cargo pegado a la empresa («Contador General Cementos Pacasmayo S.A.A.») no
  // convierte al cargo en parte del nombre.
  for (let i = 0; i < words.length && i <= 2; i++) {
    const tail = words.slice(i).join(" ");
    if (COMPANY_SUFFIX.test(tail)) return true;
    if (!NAME_WORD.test(words[i]!)) return false;
  }
  return false;
}

/**
 * Palabras de una línea de formación complementaria: cursos, talleres, seminarios.
 * Las certificaciones NO cuentan aquí: una certificación en una herramienta sí es
 * evidencia razonable de dominio, un curso suelto no.
 */
// La palabra va ANTES del término y cerca, sin comas en medio: «Curso de SAP FI»,
// «Capacitación en Excel». En «Manejo Excel, que perfeccionaré con un curso», el
// curso viene después y la persona dice que ya lo maneja: no cuenta.
// reglas-v14: admite «:» tras la palabra («Curso: SAP FI») y las palabras en inglés.
const TRAINING_BEFORE =
  /\b(?:curso|cursos|taller|talleres|capacitacion|capacitaciones|seminario|seminarios|webinar|diplomado|diplomados|course|courses|workshop|workshops)\b:?(?:\s+[^\s,;:()]+){0,4}\s*$/;
/**
 * Línea rotulada como lista de cursos («Cursos: Legislación laboral básica,
 * Gestión de personal»): todo lo que enumera es formación (reglas-v14).
 */
const TRAINING_LABEL = /^(?:cursos?|talleres?|capacitaciones|seminarios?|diplomados?|courses?|trainings?|workshops?)\s*:/;
/**
 * Curso o certificación aún sin terminar, anotado entre paréntesis junto al
 * término: «TypeScript fundamentals (in progress)», «SAP FI (en curso)»
 * (reglas-v14). Solo el paréntesis con la marca sola: «(proyecto en curso)»
 * describe un trabajo en marcha, no un estudio.
 */
const IN_PROGRESS_NOTE = /\(\s*(?:in progress|ongoing|en curso|en progreso|cursando|por culminar)\s*\)/;
/** Encabezados de secciones de formación complementaria. */
const TRAINING_HEADING =
  /^(?:cursos|capacitaciones|seminarios|talleres|diplomados|formacion complementaria|estudios complementarios|cursos y capacitaciones|courses|training|trainings|workshops)\b/;
/**
 * Encabezado que junta cursos con lo que la persona sabe hacer («CURSOS Y
 * CONOCIMIENTOS», «Cursos y habilidades»): lo que enumera no es solo formación
 * (reglas-v15). Lo que diga «Curso de…» en la propia línea sigue contando como curso.
 */
const MIXED_HEADING = /\b(?:conocimientos?|habilidades|aptitudes|competencias|skills|herramientas|informatica)\b/;
/** Línea con aspecto de encabezado: corta y toda en mayúsculas. */
function isHeadingLine(line: string): boolean {
  const letters = line.replace(/[^\p{L}]/gu, "");
  return letters.length >= 4 && line.trim().length <= 40 && letters === letters.toUpperCase();
}

/**
 * El término aparece en un curso o taller (reglas-v11): precedido de cerca por la
 * palabra («Curso de SAP FI (2024)») o bajo un encabezado de cursos o
 * capacitaciones. Haber estudiado una herramienta no muestra que se haya usado.
 */
export function isTrainingMention(original: string, haystack: NormalizedText, match: Match): boolean {
  const start = haystack.map[match.start]!;
  const line = lineAround(original, start);
  if (TRAINING_BEFORE.test(normalizeForSearch(original.slice(line.from, start)).text)) return true;
  let lineText = normalizeForSearch(original.slice(line.from, line.to)).text;
  // Un paréntesis que el PDF partió en dos líneas en una columna angosta
  // («TypeScript fundamentals (in» / «progress)»): se lee también la siguiente.
  if (/\([^)]*$/.test(lineText) && line.to < original.length) {
    const next = lineAround(original, line.to + 1);
    lineText += ` ${normalizeForSearch(original.slice(next.from, next.to)).text}`;
  }
  if (TRAINING_LABEL.test(lineText) || IN_PROGRESS_NOTE.test(lineText)) return true;
  // Encabezado más cercano por encima (hasta 30 líneas).
  let cursor = line.from - 1;
  for (let i = 0; i < 30 && cursor > 0; i++) {
    const previous = lineAround(original, cursor);
    const text = original.slice(previous.from, previous.to);
    if (isHeadingLine(text)) {
      const heading = normalizeForSearch(text.trim()).text;
      return TRAINING_HEADING.test(heading) && !MIXED_HEADING.test(heading);
    }
    cursor = previous.from - 1;
  }
  return false;
}
