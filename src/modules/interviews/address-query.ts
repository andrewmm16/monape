/**
 * Interpreta lo que RRHH escribe como dirección peruana antes de buscarla en
 * OpenStreetMap. Hace falta por dos cosas que el buscador no resuelve solo:
 *
 * - No entiende abreviaturas: «jr los zafiros» puede terminar en otro país.
 * - Casi no tiene numeración en Perú: «jirón los zafiros 2023» devuelve la calle
 *   sin número, así que la numeración se separa para no perderla al elegir.
 */
export type AddressQuery = {
  /** Con abreviaturas expandidas y la numeración en su sitio (para buscar la casa exacta). */
  full: string;
  /** Sin numeración ni interior (para buscar la vía). */
  street: string;
  /** La vía sin su tipo («Los Zafiros»), si lo traía: en el mapa muchas calles se llaman solo así. */
  name: string | null;
  /** Número de casa, comparable con el del mapa. */
  houseNumber: string | null;
  /** Departamento, oficina, piso…: el mapa no los tiene y solo van en el texto. */
  interior: string | null;
  /** Lo que va tras el nombre de la vía: «2023», «2023 Dpto. 401», «Mz. B Lt. 5», «Cdra. 24», «Km 12». */
  suffix: string | null;
};

const WORD_CHAR = "\\p{L}\\p{N}";

/** Palabra completa, con punto opcional (admite «jr.los zafiros», sin espacio). */
function word(alternatives: string, prefix = `(?<![${WORD_CHAR}])`): RegExp {
  return new RegExp(`${prefix}(?:${alternatives})(?:\\.|(?![${WORD_CHAR}]))`, "giu");
}

/** Abreviaturas sin ambigüedad: se expanden en cualquier parte de la dirección. */
const ABBREVIATIONS: [RegExp, string][] = [
  [word("jrn?"), "Jirón"],
  [word("avd?a?"), "Avenida"],
  [word("psje?|pje"), "Pasaje"],
  [word("urb"), "Urbanización"],
  [word("prol(?:ong)?"), "Prolongación"],
  [word("alam"), "Alameda"],
  [word("carr|ctra"), "Carretera"],
  [word("aa\\.?\\s?hh|a\\.h"), "Asentamiento Humano"],
  [word("mr?cal"), "Mariscal"],
  [word("gral"), "General"],
  [word("cnel"), "Coronel"],
  [word("tte"), "Teniente"],
  [word("pdte"), "Presidente"],
  [word("sta"), "Santa"],
  [word("sto"), "Santo"],
  [word("dr"), "Doctor"],
];

/** Abreviaturas que solo significan esto al inicio («Ca. Los Pinos»; «ca» suelto podría ser otra cosa). */
const LEADING_ABBREVIATIONS: [RegExp, string][] = [
  [word("ca|cll?", "^"), "Calle"],
  [word("pj", "^"), "Pasaje"],
  [word("ah", "^"), "Asentamiento Humano"],
];

const ROAD_TYPE = /^(?:jir[oó]n|avenida|calle|pasaje|urbanizaci[oó]n|prolongaci[oó]n|alameda|carretera|asentamiento humano|[oó]valo)(?:\s+|$)/iu;

const INTERIOR = new RegExp(
  `(?<![${WORD_CHAR}])(dpto|depto|dep|departamento|int|interior|of|oficina|piso|tda|tienda)\\.?\\s*(\\d[${WORD_CHAR}-]*|[a-z](?![${WORD_CHAR}]))`,
  "giu",
);
const INTERIOR_LABELS: Record<string, string> = {
  dpto: "Dpto.",
  depto: "Dpto.",
  dep: "Dpto.",
  departamento: "Dpto.",
  int: "Int.",
  interior: "Int.",
  of: "Of.",
  oficina: "Of.",
  piso: "Piso",
  tda: "Tda.",
  tienda: "Tda.",
};

/** «Nro 2023», «N° 2023», «#2023». */
const MARKED_NUMBER = new RegExp(
  `(?:(?<![${WORD_CHAR}])(?:n[uú]m(?:ero)?|nro|n\\.?[°º]|no|n)\\.?\\s*|#\\s*)(\\d[${WORD_CHAR}-]*)`,
  "iu",
);
const BLOCK = new RegExp(
  `(?<![${WORD_CHAR}])(?:mza?|manzana)\\.?\\s*((?!(?:de|el|la)(?![${WORD_CHAR}]))[a-z]{1,2}\\d{0,3}|\\d{1,3}[a-z]?)(?![${WORD_CHAR}])(?:[\\s,-]*(?:lte?|lote)\\.?\\s*(\\d{1,3}[a-z]?)(?![${WORD_CHAR}]))?`,
  "iu",
);
const CITY_BLOCK = new RegExp(`(?<![${WORD_CHAR}])(?:cdra|cda|cuadra)\\.?\\s*(\\d{1,3})(?![${WORD_CHAR}])`, "iu");
const KILOMETER = new RegExp(`(?<![${WORD_CHAR}])(?:km|kil[oó]metro)\\.?\\s*(\\d+(?:[.,]\\d+)?)(?![${WORD_CHAR}])`, "iu");

/** Número suelto de casa: 2023, 120-B, 120B. */
const PLAIN_NUMBER = /^\d{1,6}(?:-?[a-z])?(?:-[a-z0-9]+)?$/iu;

function tidy(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,(?:\s*,)+/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

function expandAbbreviations(raw: string): string {
  let text = tidy(raw);
  for (const [pattern, full] of LEADING_ABBREVIATIONS) text = text.replace(pattern, `${full} `);
  for (const [pattern, full] of ABBREVIATIONS) text = text.replace(pattern, `${full} `);
  return tidy(text);
}

function stripRoadType(text: string): string {
  return text.replace(ROAD_TYPE, "").trim();
}

/**
 * Primer número que parece de casa: debe ir después del nombre de la vía
 * («Calle 8 120» → 120) y no ser parte de ella («Av. 28 de Julio» no tiene número).
 */
function findPlainNumber(text: string): { number: string; rest: string } | null {
  const tokens = text.split(" ");
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const hasComma = token.endsWith(",");
    const bare = hasComma ? token.slice(0, -1) : token;
    if (!PLAIN_NUMBER.test(bare)) continue;
    if (!stripRoadType(tokens.slice(0, index).join(" "))) continue;
    if (/^d(?:e|el)?$/i.test(tokens[index + 1] ?? "")) continue;
    const before = tokens.slice(0, index).join(" ");
    const after = tokens.slice(index + 1).join(" ");
    return { number: bare, rest: `${before}${hasComma ? "," : ""} ${after}` };
  }
  return null;
}

export function parseAddressQuery(raw: string): AddressQuery {
  const interior: string[] = [];
  let text = expandAbbreviations(raw).replace(INTERIOR, (_match, kind: string, value: string) => {
    interior.push(`${INTERIOR_LABELS[kind.toLowerCase()]} ${value.toUpperCase()}`);
    return " ";
  });
  text = tidy(text);

  const location: string[] = [];
  const block = text.match(BLOCK);
  if (block) {
    location.push(block[2] ? `Mz. ${block[1]!.toUpperCase()} Lt. ${block[2].toUpperCase()}` : `Mz. ${block[1]!.toUpperCase()}`);
    text = tidy(text.replace(BLOCK, " "));
  }
  const cityBlock = text.match(CITY_BLOCK);
  if (cityBlock) {
    location.push(`Cdra. ${cityBlock[1]}`);
    text = tidy(text.replace(CITY_BLOCK, " "));
  }
  const kilometer = text.match(KILOMETER);
  if (kilometer) {
    location.push(`Km ${kilometer[1]}`);
    text = tidy(text.replace(KILOMETER, " "));
  }

  // La numeración marcada se deja como número limpio para buscar la casa exacta.
  const marked = text.match(MARKED_NUMBER);
  if (marked) text = tidy(text.replace(MARKED_NUMBER, ` ${marked[1]} `));

  const full = text;
  const plain = findPlainNumber(text);
  const houseNumber = plain?.number ?? null;
  const street = plain ? tidy(plain.rest) : text;

  const name = stripRoadType(street);
  const interiorText = interior.length > 0 ? interior.join(" ") : null;
  const suffixParts = [houseNumber, ...location, interiorText].filter(Boolean);

  return {
    full,
    street,
    name: name !== street && name.length >= 3 ? name : null,
    houseNumber,
    interior: interiorText,
    suffix: suffixParts.length > 0 ? suffixParts.join(" ") : null,
  };
}
