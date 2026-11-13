import { equivalentsFor } from "./synonyms";
import { buildExperienceIndex, estimateFromIndex, type ExperienceIndex } from "./experience-dates";
import {
  findTermOccurrences,
  isAspirationalMention,
  isLinkMention,
  isNegatedMention,
  isThirdPartyMention,
  normalizeForSearch,
  normalizeTerm,
  sentenceBounds,
  sentenceExcerpt,
  termVariants,
  type Match,
  type NormalizedText,
} from "./text";
import type { Evidence, ItemAssessment, RequirementInput } from "./types";

/**
 * Motor de reglas determinista (sin servicios externos). Para el mismo texto y
 * los mismos requisitos produce siempre el mismo resultado.
 *
 * Reglas:
 *  - Sin términos configurados → pendiente de verificación (no evaluable).
 *  - Ningún término encontrado → sin evidencia (nunca "no cumplido": la
 *    ausencia de una mención no prueba que la persona no cumpla).
 *  - Competencias → pendiente de verificación aunque se mencionen.
 *  - Requisitos legales/esenciales → pendiente de verificación con la evidencia.
 *  - Experiencia mínima en años → acreditado si cerca de los términos hay una
 *    mención explícita de años DE EXPERIENCIA suficientes, o si los periodos con
 *    fechas de la sección de experiencia (experience-dates.ts) suman al menos el
 *    mínimo aun en su supuesto más corto; si no, pendiente (nunca "no cumplido").
 *    Los cálculos con fechas dependen de la fecha de referencia recibida.
 *  - En otro caso, términos encontrados → acreditado, con extractos del CV.
 *
 * Novedades de reglas-v3 (todas deterministas, sin servicios externos):
 *  - Cada término se busca también en singular/plural y masculino/femenino
 *    («comprobante» ≈ «comprobantes», «contador» ≈ «contadora»).
 *  - La evidencia es la ORACIÓN completa del CV donde aparece el término, y se
 *    prefieren las oraciones que reúnen más términos distintos del requisito.
 *  - Los años de experiencia se leen en más formas: «3 años de experiencia»,
 *    «tres años como contador», «5+ años en…», «experiencia de más de 4 años».
 *    Cuenta primero la mención que está en la misma oración que el término, y
 *    la evidencia mostrada es esa oración.
 *  - Si el término solo aparece negado («sin experiencia en SAP»), no se acredita.
 *
 * Novedades de reglas-v4:
 *  - La colegiatura acredita la formación: «colegiado/a» y «colegiatura» cuentan
 *    como frase de estudios concluidos, porque en el Perú no se puede estar
 *    colegiado sin haber terminado la carrera. «Colegio» a secas no cuenta: en
 *    el Perú designa la educación secundaria, y una colegiatura «en trámite»
 *    tampoco acredita: queda pendiente de verificación.
 *  - «Conocimientos nulos de Excel» se lee como una negación.
 *  - El texto se limpia de caracteres invisibles y se unen las palabras que la
 *    extracción de PDF parte con un guion al final de la línea.
 *  - La pista de estudios debe estar CERCA del término y se busca por LÍNEA, no
 *    por oración (ver formationViews y CUE_RADIUS).
 *  - El nivel declarado se lee en el ítem de la enumeración donde está el
 *    término, no en toda la oración (ver itemTextOf).
 *  - La sección de referencias se oculta: habla de otra persona (maskReferences).
 *  - Lo que hace un tercero no acredita al candidato: «mi equipo usaba Concar»
 *    o «la empresa utiliza SAP» quedan pendientes (isThirdPartyMention).
 *  - Un término de uno o dos caracteres solo cuenta escrito como sigla
 *    (shortTermMatches, en text.ts).
 *
 * Novedades de reglas-v5:
 *  - En habilidades técnicas, competencias, experiencia y «otro» se buscan
 *    también las equivalencias de evidencia de synonyms.ts («libros contables»
 *    para «contabilidad»). El rationale indica qué expresión equivalente
 *    coincidió, para que RRHH la verifique con la cita delante.
 */
export const RULE_ENGINE_VERSION = "reglas-v5";

const MAX_EVIDENCE = 3;
const YEARS_WINDOW = 160;
// Números escritos con letras, para leer «tres años como contador».
const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20,
};
const NUM = "(\\d{1,2}(?:[.,]\\d)?|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte)(?:\\s*\\(\\d{1,2}\\))?";
// Solo cuentan años expresados como experiencia («5 años de experiencia»,
// «experiencia de más de 3 años», «tres años como contador»). Así no se toman
// como experiencia la edad («26 años») ni la antigüedad de una empresa
// («empresa con 30 años en el mercado»).
const EXPERIENCE_YEARS_PATTERNS = [
  new RegExp(`\\b${NUM}\\s*\\+?\\s*(?:anos?|years?)\\s+(?:de\\s+|of\\s+)?(?:experiencia|experience|trayectoria|ejercicio|carrera|labor|practica)\\b`, "g"),
  new RegExp(`\\b(?:experiencia|experience)\\s+(?:laboral\\s+|profesional\\s+)?(?:de\\s+|of\\s+)?(?:mas\\s+de\\s+|over\\s+|al\\s+menos\\s+)?${NUM}\\s*\\+?\\s*(?:anos?|years?)\\b`, "g"),
  new RegExp(`\\b${NUM}\\s*\\+?\\s*anos?\\s+(?:como|trabajando|laborando|ejerciendo|desempenando|dedicad[oa])\\b`, "g"),
  new RegExp(`\\b${NUM}\\s*\\+?\\s*anos?\\s+en\\s+(?!el\\s+(?:mercado|mundo|pais)\\b)`, "g"),
];

function parseYears(token: string): number {
  return NUMBER_WORDS[token] ?? Number.parseFloat(token.replace(",", "."));
}

type TermMatch = Match & { term: string; via?: string };

/** Categorías donde se aceptan equivalencias de evidencia. */
export function isEquivalenceScope(requirement: RequirementInput): boolean {
  return (
    requirement.category === "habilidad_tecnica" ||
    requirement.category === "competencia" ||
    requirement.category === "experiencia" ||
    requirement.category === "otro"
  );
}

function uniqueTerms(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of keywords) {
    const normalized = normalizeTerm(keyword);
    if (normalized.length >= 1 && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(keyword.trim());
    }
  }
  return result;
}

/**
 * Cada término y sus variantes de número y género; `term` es siempre el término
 * configurado. Los directos se insertan antes que los de equivalencia (`via`),
 * así un fragmento ya capturado como directo gana sobre el equivalente.
 */
function collectMatches(
  haystack: NormalizedText,
  terms: string[],
  expand: (term: string) => string[] = () => [],
): TermMatch[] {
  const found = new Map<string, TermMatch>();
  const add = (term: string, surface: string, via?: string) => {
    // Un término corto (≤2) se busca tal cual, con su grafía, para que solo cuente como
    // sigla: las variantes salen en minúsculas y habilitarían «ti» suelto.
    const short = surface.replace(/[^\p{L}\p{N}]/gu, "").length <= 2;
    for (const variant of via !== undefined && short ? [surface] : termVariants(surface)) {
      for (const match of findTermOccurrences(haystack, variant)) {
        const key = `${term}|${match.start}|${match.end}`;
        if (!found.has(key)) found.set(key, via === undefined ? { ...match, term } : { ...match, term, via });
      }
    }
  };
  for (const term of terms) add(term, term);
  for (const term of terms) for (const e of expand(term)) add(term, e, e);
  return [...found.values()].sort((a, b) => a.start - b.start);
}

/**
 * Evidencia por oraciones: cada oración del CV que contiene un término cuenta
 * una vez, y se eligen primero las que aportan más términos distintos del
 * requisito (hasta MAX_EVIDENCE).
 */
function pickEvidence(original: string, haystack: NormalizedText, matches: TermMatch[]): Evidence[] {
  type Group = { first: TermMatch; terms: Set<string>; surfaces: Set<string> };
  const groups = new Map<number, Group>();
  for (const match of matches) {
    const start = haystack.map[match.start]!;
    const end = haystack.map[match.end - 1]! + 1;
    const { from } = sentenceBounds(original, start, end);
    const group = groups.get(from) ?? { first: match, terms: new Set<string>(), surfaces: new Set<string>() };
    group.terms.add(match.term);
    group.surfaces.add(original.slice(start, end));
    groups.set(from, group);
  }
  const remaining = [...groups.values()];
  const covered = new Set<string>();
  const chosen: Group[] = [];
  while (chosen.length < MAX_EVIDENCE && remaining.length > 0) {
    let bestIndex = 0;
    let best = { fresh: -1, size: -1, start: Infinity };
    remaining.forEach((group, index) => {
      const fresh = [...group.terms].filter((t) => !covered.has(t)).length;
      const better =
        fresh > best.fresh ||
        (fresh === best.fresh && group.terms.size > best.size) ||
        (fresh === best.fresh && group.terms.size === best.size && group.first.start < best.start);
      if (better) {
        best = { fresh, size: group.terms.size, start: group.first.start };
        bestIndex = index;
      }
    });
    const [group] = remaining.splice(bestIndex, 1);
    group!.terms.forEach((t) => covered.add(t));
    chosen.push(group!);
  }
  return chosen
    .sort((a, b) => a.first.start - b.first.start)
    .map((group) => ({ ...sentenceExcerpt(original, haystack, group.first), matched: [...group.surfaces] }));
}

type YearsMention = { value: number; start: number; end: number };

/**
 * Años de experiencia mencionados explícitamente cerca de las coincidencias.
 * Para cada coincidencia se toma la mención más próxima (no la mayor), con
 * prioridad a la que está en su misma oración (si se conoce el texto original),
 * de modo que una cifra referida a otra experiencia del CV no se atribuya a esta.
 */
export function findYearsMention(haystack: NormalizedText, matches: Match[], original?: string): YearsMention | null {
  let best: YearsMention | null = null;
  for (const match of matches) {
    const from = Math.max(0, match.start - YEARS_WINDOW);
    const to = Math.min(haystack.text.length, match.end + YEARS_WINDOW);
    const windowText = haystack.text.slice(from, to);
    const anchor = match.start - from;
    const sentence = original
      ? sentenceBounds(original, haystack.map[match.start]!, haystack.map[match.end - 1]! + 1)
      : null;
    let nearest: (YearsMention & { rank: number; distance: number }) | null = null;
    for (const pattern of EXPERIENCE_YEARS_PATTERNS) {
      for (const found of windowText.matchAll(pattern)) {
        const value = parseYears(found[1]!);
        const index = found.index ?? 0;
        if (!Number.isFinite(value) || value > 50) continue;
        const start = from + index;
        const end = Math.min(haystack.text.length, start + found[0].length);
        const originalAt = haystack.map[start]!;
        const sameSentence = sentence !== null && originalAt >= sentence.from && originalAt < sentence.to;
        const rank = sameSentence ? 0 : 1;
        const distance = Math.abs(index - anchor);
        if (nearest === null || rank < nearest.rank || (rank === nearest.rank && distance < nearest.distance)) {
          nearest = { value, start, end, rank, distance };
        }
      }
    }
    if (nearest && (best === null || nearest.value > best.value)) {
      best = { value: nearest.value, start: nearest.start, end: nearest.end };
    }
  }
  return best;
}

/** Años de experiencia mencionados cerca de las coincidencias, o `null`. */
export function findYearsNear(haystack: NormalizedText, matches: Match[], original?: string): number | null {
  return findYearsMention(haystack, matches, original)?.value ?? null;
}

function formatYears(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

// Estudios sin terminar o título aún no obtenido: no acreditan la formación.
const IN_PROGRESS = /\b(?:en curso|cursando|ciclo|semestre|estudiante|actualmente estudiando|trunc[oa]s?|inconclus[oa]s?|en tramite|en proceso|por obtener)\b/;
const STUDY_CUES = /\b(?:bachiller|titul[oa]d[oa]?|titulo|licenciad[oa]|egresad[oa]|graduad[oa]|colegiad[oa]|colegiatura|grado|maestria|magister|doctorad[oa]|diplomado|especializacion|posgrado|universidad|instituto|tecnic[oa]|ingenier[oa]|carrera|estudios?|facultad)\b/;
const BASIC_LEVEL = /\b(?:basic[oa]s?|inicial|principiante|elemental|nociones)\b/;
const HIGHER_LEVEL = /\b(?:intermedi[oa]s?|avanzad[oa]s?|experto|experta|senior|advanced|intermediate|fluido|fluida|nativ[oa])\b/;

/**
 * Niveles del marco común europeo escritos solo con el código. Un CV peruano
 * pone «Inglés A2» o «Inglés B2» sin la palabra mucho más a menudo que con
 * ella, y sin esto «Inglés A2» acreditaba un requisito de «Inglés intermedio
 * (B2)»: A2 es elemental, justo lo contrario.
 *
 * Se aplica SOLO a requisitos de idioma, y por eso no interfiere con nada más:
 * «B2B» (ventas entre empresas) no coincide porque `\b` exige que el código
 * termine ahí, y un código suelto en el nombre de una empresa («Comercial A1
 * SAC») queda fuera porque ese requisito no es de idioma.
 */
const CEFR_RANK: ReadonlyArray<readonly [string, number]> = [
  ["a1", 1],
  ["a2", 2],
  ["b1", 3],
  ["b2", 4],
  ["c1", 5],
  ["c2", 6],
];
const CEFR_CODE = /\b([abc][12])\b/g;
const LANGUAGE_WORDS =
  /\b(?:idioma|idiomas|ingles|portugues|frances|italiano|aleman|chino|mandarin|japones|coreano|ruso)\b/;

function isLanguageRequirement(requirement: RequirementInput): boolean {
  return requirement.category === "idioma" || LANGUAGE_WORDS.test(normalizeTerm(requirement.description));
}

/**
 * Nivel del marco europeo que aparece en un texto, como número de 1 (A1) a
 * 6 (C2). `modo` decide qué hacer cuando hay varios: en el REQUISITO se toma el
 * menor, porque las vacantes se escriben como rango o alternativa («intermedio
 * B1-B2») y lo que importa es el mínimo que la empresa acepta; en el CV se toma
 * el mayor, porque es lo que la persona declara haber alcanzado. Es la misma
 * asimetría que en la escalera de grados académicos.
 */
function cefrLevel(texto: string, modo: "minimo" | "maximo"): number | null {
  let encontrado: number | null = null;
  CEFR_CODE.lastIndex = 0;
  for (let hallado = CEFR_CODE.exec(texto); hallado !== null; hallado = CEFR_CODE.exec(texto)) {
    const rango = CEFR_RANK.find(([codigo]) => codigo === hallado![1])?.[1];
    if (rango === undefined) continue;
    if (encontrado === null) encontrado = rango;
    else encontrado = modo === "minimo" ? Math.min(encontrado, rango) : Math.max(encontrado, rango);
  }
  return encontrado;
}

/**
 * Escalera de grados académicos del Perú, de menor a mayor. En el Perú son
 * grados legalmente distintos: egresar no da el bachillerato y el bachillerato
 * no da el título, así que un puesto que pide título no queda cumplido con un
 * «egresado».
 *
 * Solo entran los marcadores inequívocos. «Universidad», «instituto»,
 * «carrera», «estudios», «grado», «posgrado» y «diplomado» dicen DÓNDE o QUÉ
 * se estudió, no qué grado se obtuvo: quedan fuera y por tanto nunca bloquean
 * (eso mantiene la decisión de la empresa sobre el diplomado y los CV de
 * plantilla que solo ponen «Universidad X | Contabilidad | 2016-2021»).
 *
 * «Colegio» es secundaria en el Perú, salvo cuando es un colegio profesional
 * («Colegio de Contadores Públicos»), donde significa justo lo contrario:
 * colegiatura. De ahí el `(?!\s+de\b)`, con `\b` y no `\s`: en una columna
 * estrecha el PDF parte «Colegio de / Contadores Públicos», y ese «de» cierra
 * la línea. Si la excepción no lo cubriera, la línea valdría como secundaria y
 * podría bloquear a un profesional titulado, que es el error caro.
 */
const DEGREE_LADDER: Array<readonly [number, RegExp]> = [
  [1, /\bsecundaria\b|\bprimaria\b|\beducacion basica\b|\bcolegio\b(?!\s+de\b)/],
  [2, /\btecnic[oa]s?\b/],
  [3, /\begresad[oa]s?\b/],
  [4, /\bbachiller(?:ato)?\b/],
  [5, /\b(?:titulad[oa]s?|titulo|licenciad[oa]s?|licenciatura|colegiad[oa]s?|colegiatura)\b/],
  [6, /\b(?:maestria|magister|mba)\b/],
  [7, /\b(?:doctorad[oa]s?|phd)\b/],
];

export const DEGREE_NAMES: Record<number, string> = {
  1: "estudios escolares",
  2: "estudios técnicos",
  3: "la carrera concluida sin grado (egresado)",
  4: "el grado de bachiller",
  5: "título profesional",
  6: "maestría",
  7: "doctorado",
};

/**
 * Grado que exige el requisito: el MÍNIMO de los que nombra. Las vacantes se
 * redactan como alternativas («Título o bachiller en Contabilidad»), y lo que
 * importa es el menor que la empresa acepta. Null si no nombra ninguno.
 */
export function requiredDegree(description: string): number | null {
  const texto = normalizeTerm(description);
  let minimo: number | null = null;
  for (const [rango, patron] of DEGREE_LADDER) {
    if (patron.test(texto) && (minimo === null || rango < minimo)) minimo = rango;
  }
  return minimo;
}

/** Grado que muestra el CV: el MÁXIMO de los que nombra. Null si no nombra ninguno. */
function evidencedDegree(texto: string): number | null {
  let maximo: number | null = null;
  for (const [rango, patron] of DEGREE_LADDER) {
    if (patron.test(texto) && (maximo === null || rango > maximo)) maximo = rango;
  }
  return maximo;
}

// Distancia máxima entre el término y su pista de estudios (ver formationViews).
const CUE_RADIUS = 40;
// Tope para buscar la señal de estudios SIN terminar. Una línea normal cabe de
// sobra; el tope solo actúa en una hoja extraída sin saltos de línea, donde la
// «línea» es el CV entero y un «en curso» de cualquier otra sección lo bloquearía.
const IN_PROGRESS_RADIUS = 200;
// Separadores de ítem dentro de una enumeración: el nivel declarado pertenece al
// elemento de la lista donde está, no a los vecinos. «Excel (básico) y Power BI
// avanzado» son dos ítems. El paréntesis que ABRE no separa: califica al ítem
// anterior. El guion tampoco: «básico-intermedio» es un solo nivel declarado.
const ITEM_BREAK = /[,;)•·|]|\s(?:y|e|o|u|and|or)\s/iu;
// La misma, global y reutilizada: crearla en cada llamada se nota con muchas coincidencias.
const ITEM_BREAK_ALL = new RegExp(ITEM_BREAK.source, "giu");

/** Índices del término en el texto original. */
function offsetsOf(haystack: NormalizedText, match: Match) {
  return { start: haystack.map[match.start]!, end: haystack.map[match.end - 1]! + 1 };
}

/**
 * Las dos vistas que necesita un requisito de formación, ambas sobre la LÍNEA y
 * no sobre la oración: en «Universidad Ficticia | Contabilidad | 2016-2021» la
 * barra corta la oración y dejaría la carrera sin su pista, y ese formato de
 * plantilla es de los más frecuentes.
 *
 *  - `pista`: lo que rodea al término hasta `CUE_RADIUS` caracteres. Ahí debe
 *    estar la señal de estudios; de lo contrario una hoja extraída sin saltos
 *    de línea acreditaría cualquier cosa.
 *  - `linea`: la línea completa, donde se busca la señal de estudios SIN
 *    terminar. Es la vista más amplia a propósito: cualquier indicio de que la
 *    carrera está en curso debe impedir que se acredite.
 */
function formationViews(original: string, haystack: NormalizedText, match: Match): { pista: string; linea: string } {
  const { start, end } = offsetsOf(haystack, match);
  let from = start;
  while (from > 0 && original[from - 1] !== "\n" && original[from - 1] !== "\r") from--;
  let to = end;
  while (to < original.length && original[to] !== "\n" && original[to] !== "\r") to++;
  return {
    pista: normalizeForSearch(original.slice(Math.max(from, start - CUE_RADIUS), Math.min(to, end + CUE_RADIUS))).text,
    linea: normalizeForSearch(
      original.slice(Math.max(from, start - IN_PROGRESS_RADIUS), Math.min(to, end + IN_PROGRESS_RADIUS)),
    ).text,
  };
}

/**
 * Texto normalizado del ítem de la enumeración donde está el término: se corta
 * en el separador más cercano a cada lado, dentro de la misma oración.
 */
function itemTextOf(original: string, haystack: NormalizedText, match: Match): string {
  const { start, end } = offsetsOf(haystack, match);
  const { from, to } = sentenceBounds(original, start, end);
  const oracion = original.slice(from, to);
  // Se busca el separador más cercano a cada lado en una sola pasada. A la
  // izquierda interesa dónde TERMINA el separador; a la derecha, dónde empieza.
  // Sin acumularlos en un arreglo: una oración con decenas de miles de comas
  // (un CV sin saltos de línea) reventaría un Math.max con spread.
  let desde = from;
  let hasta = to;
  ITEM_BREAK_ALL.lastIndex = 0;
  for (let hallado = ITEM_BREAK_ALL.exec(oracion); hallado !== null; hallado = ITEM_BREAK_ALL.exec(oracion)) {
    const abre = from + hallado.index;
    const cierra = abre + hallado[0].length;
    if (cierra <= start) {
      if (cierra > desde) desde = cierra;
    } else if (abre >= end) {
      hasta = abre;
      break;
    }
  }
  return normalizeForSearch(original.slice(desde, hasta)).text;
}

/** Requisito de estudios o título, por su categoría o por cómo está redactado. */
export function isFormationRequirement(requirement: RequirementInput): boolean {
  if (requirement.category === "formacion") return true;
  return /\b(?:titulo|bachiller|titulad[oa]|licenciad[oa]|egresad[oa]|grado|maestria|diplomado|estudios)\b/.test(normalizeTerm(requirement.description));
}

export function asksForHigherLevel(requirement: RequirementInput): boolean {
  const descripcion = normalizeTerm(requirement.description);
  if (/\b(?:intermedi[oa]s?|avanzad[oa]s?|advanced|intermediate|experto|senior)\b/.test(descripcion)) return true;
  // «Inglés B2» a secas también pide un nivel, aunque no use la palabra.
  return isLanguageRequirement(requirement) && (cefrLevel(descripcion, "minimo") ?? 0) > 2;
}

export function evaluateRequirement(
  original: string,
  haystack: NormalizedText,
  requirement: RequirementInput,
  referenceDate: Date,
  experienceIndex: () => ExperienceIndex = () => buildExperienceIndex(original, referenceDate),
): ItemAssessment {
  const base = { requirementId: requirement.id };
  const terms = uniqueTerms(requirement.keywords);

  if (terms.length === 0) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence: [],
      rationale:
        "El requisito no tiene términos de búsqueda configurados, por lo que el motor de reglas no puede evaluarlo. Requiere revisión manual.",
    };
  }

  const expand = isEquivalenceScope(requirement) ? equivalentsFor : () => [];
  const allMatches = collectMatches(haystack, terms, expand);
  // «Sin experiencia en SAP» menciona el término pero no lo acredita.
  const matches = allMatches.filter(
    (m) =>
      !isNegatedMention(original, haystack, m) &&
      !isAspirationalMention(original, haystack, m) &&
      !isThirdPartyMention(original, haystack, m) &&
      !isLinkMention(original, haystack, m),
  );
  if (matches.length === 0 && allMatches.length > 0) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence: pickEvidence(original, haystack, allMatches),
      rationale: `El CV menciona: ${[...new Set(allMatches.map((m) => m.term))].join(", ")}, pero solo en frases que parecen negarlo, expresar un interés, atribuirlo a otra persona o dentro de un correo o un enlace (por ejemplo «sin experiencia en…», «interés en…», «mi equipo usaba…» o «concar.com.pe»). Revíselo en el CV.`,
    };
  }
  if (matches.length === 0) {
    return {
      ...base,
      assessment: "sin_evidencia",
      evidence: [],
      rationale: `El CV no menciona ninguno de los términos configurados (${terms.join(", ")}). La ausencia de una mención no implica que la persona no cumpla el requisito.`,
    };
  }

  const evidence = pickEvidence(original, haystack, matches);
  const foundTerms = [...new Set(matches.map((m) => m.term))];
  const foundLabel = (term: string): string => {
    const own = matches.filter((m) => m.term === term);
    if (own.length === 0 || own.some((m) => m.via === undefined)) return term;
    const vias = [...new Set(own.map((m) => m.via!))];
    return `${term} (por equivalencia: ${vias.map((v) => `«${v}»`).join(", ")})`;
  };
  const foundText = `El CV menciona: ${foundTerms.map(foundLabel).join(", ")}.`;

  // Formación: el término debe aparecer en una frase de estudios o título, no en
  // «con interés en Contabilidad» ni en el cargo («Asistente Contable»).
  if (requirement.minYears === null && isFormationRequirement(requirement)) {
    const pedido = requiredDegree(requirement.description);
    let alcanzado: number | null = null;
    const studied = matches.filter((m) => {
      const { pista, linea } = formationViews(original, haystack, m);
      if (!STUDY_CUES.test(pista) || IN_PROGRESS.test(linea)) return false;
      // El grado se lee en la vista ANCHA: así un grado mayor que esté en otra
      // parte de la línea protege al candidato de que lo bloquee uno menor.
      const grado = evidencedDegree(linea);
      if (grado !== null && (alcanzado === null || grado > alcanzado)) alcanzado = grado;
      return true;
    });
    // Grado insuficiente: nunca "no cumplido" —el grado puede estar en un
    // documento que el CV no menciona—, sino a revisión con la cita delante.
    if (studied.length > 0 && pedido !== null && alcanzado !== null && alcanzado < pedido) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence: pickEvidence(original, haystack, studied),
        rationale: `${foundText} Pero el CV declara ${DEGREE_NAMES[alcanzado]} y el puesto pide ${DEGREE_NAMES[pedido]} o un grado mayor. Verifique el grado académico en el CV o con el documento.`,
      };
    }
    if (studied.length === 0) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} Pero no aparece en una frase de estudios concluidos o de título (por ejemplo «bachiller», «titulado»); puede estar en curso. Verifique la formación en el CV.`,
      };
    }
    return {
      ...base,
      assessment: requirement.isEssential ? "pendiente_verificacion" : "acreditado",
      evidence: pickEvidence(original, haystack, studied),
      rationale: requirement.isEssential
        ? `${foundText} Al ser un requisito legal o esencial, debe verificarse con documentos antes de considerarlo acreditado.`
        : `El CV menciona: ${[...new Set(studied.map((m) => m.term))].join(", ")}.`,
    };
  }

  // Nivel: si el puesto pide nivel intermedio o avanzado y el CV declara solo nivel básico, no se acredita.
  if (asksForHigherLevel(requirement)) {
    // El nivel se lee en el ítem de la enumeración donde está el término, no en
    // toda la oración: en «Excel (básico) y Power BI avanzado» el «avanzado» es
    // de Power BI.
    // `every` corta en la primera coincidencia que no sea de nivel básico, así
    // que no se calcula el ítem de todas si ya hay una que acredita.
    // En un requisito de idioma cuenta además el código del marco europeo: un
    // CV escribe «Inglés A2» mucho más a menudo que «Inglés básico». Si los dos
    // lados traen código se comparan como niveles (B1 no llega a B2); si el CV
    // no trae código, se vuelve a la comparación por palabras.
    const idioma = isLanguageRequirement(requirement);
    const pedido = idioma ? cefrLevel(normalizeTerm(requirement.description), "minimo") : null;
    const insuficiente = (text: string) => {
      if (pedido !== null) {
        const declarado = cefrLevel(text, "maximo");
        if (declarado !== null) return declarado < pedido;
      }
      return BASIC_LEVEL.test(text) && !HIGHER_LEVEL.test(text);
    };
    const soloBasico = matches.every((m) => insuficiente(itemTextOf(original, haystack, m)));
    if (soloBasico) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} Pero el CV declara un nivel básico y el puesto pide un nivel intermedio o avanzado. Verifique el nivel real.`,
      };
    }
  }

  if (requirement.category === "competencia") {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence,
      rationale: `${foundText} Una competencia no se acredita con su mención en el CV; debe verificarse en entrevista u otra prueba.`,
    };
  }

  if (requirement.minYears !== null) {
    const required = requirement.minYears;
    const mention = findYearsMention(haystack, matches, original);
    const years = mention?.value ?? null;
    // La evidencia de una mención de años es la oración que la contiene.
    let mentionEvidence: Evidence[] = evidence;
    if (mention) {
      const sentence = sentenceExcerpt(original, haystack, { start: mention.start, end: mention.end });
      mentionEvidence = [
        { ...sentence, matched: [original.slice(haystack.map[mention.start]!, haystack.map[mention.end - 1]! + 1)] },
        ...evidence.filter((e) => e.quote !== sentence.quote).slice(0, 2),
      ];
    }
    const dated = estimateFromIndex(experienceIndex(), terms);
    const minimum = formatYears(required);
    const byMention = years !== null && years >= required;
    const byDates = dated !== null && dated.minYears >= required;

    if (byMention || byDates) {
      if (byMention) {
        if (requirement.isEssential) {
          return {
            ...base,
            assessment: "pendiente_verificacion",
            evidence: mentionEvidence,
            rationale: `${foundText} Se menciona ${formatYears(years)} años de experiencia. Al ser un requisito legal o esencial, debe verificarse con documentos.`,
          };
        }
        return {
          ...base,
          assessment: "acreditado",
          evidence: mentionEvidence,
          rationale: `${foundText} Se menciona explícitamente ${formatYears(years)} años de experiencia (mínimo: ${minimum}).`,
        };
      }
      const datedText = `Según las fechas de experiencia del CV relacionadas con estos términos, suma al menos ${formatYears(dated!.minYears)} años (calculado al ${formatDate(referenceDate)}; mínimo: ${minimum}).`;
      if (requirement.isEssential) {
        return {
          ...base,
          assessment: "pendiente_verificacion",
          evidence: dated!.quotes,
          rationale: `${foundText} ${datedText} Al ser un requisito legal o esencial, debe verificarse con documentos.`,
        };
      }
      return { ...base, assessment: "acreditado", evidence: dated!.quotes, rationale: `${foundText} ${datedText}` };
    }

    if (dated !== null) {
      const mention =
        years !== null
          ? ` Además se encontró una mención de ${formatYears(years)} años cerca de esos términos.`
          : "";
      const rationale =
        dated.maxYears >= required
          ? `${foundText} Según las fechas del CV relacionadas con estos términos, suma entre ${formatYears(dated.minYears)} y ${formatYears(dated.maxYears)} años (algunas fechas solo indican el año); el mínimo es ${minimum}. Verificar.${mention}`
          : `${foundText} Según las fechas del CV relacionadas con estos términos, suma ${
              dated.minYears === dated.maxYears
                ? formatYears(dated.minYears)
                : `entre ${formatYears(dated.minYears)} y ${formatYears(dated.maxYears)}`
            } años; el mínimo es ${minimum}. Puede existir experiencia adicional sin fechas: verificar.${mention}`;
      return { ...base, assessment: "pendiente_verificacion", evidence: dated.quotes, rationale };
    }

    if (years === null) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} No se pudo determinar la duración de la experiencia (mínimo requerido: ${minimum} años). Verificar con las fechas del CV o en entrevista.`,
      };
    }
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence,
      rationale: `${foundText} Se encontró una mención de ${formatYears(years)} años cerca de esos términos; el mínimo es ${minimum}. Puede existir experiencia adicional no expresada en años: verificar.`,
    };
  }

  if (requirement.isEssential) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence,
      rationale: `${foundText} Al ser un requisito legal o esencial, debe verificarse con documentos antes de considerarlo acreditado.`,
    };
  }

  return { ...base, assessment: "acreditado", evidence, rationale: foundText };
}

// Encabezado que abre la sección de referencias. Lo que viene después habla de
// OTRA persona: su título, su colegiatura y su cargo no son del candidato.
const REFERENCES_NAME = String.raw`(?:referencias?|references)(?:\s+(?:personales?|laborales?|profesionales?|de\s+trabajo|personal|professional))?`;
const REFERENCES_HEADING = new RegExp(`^${REFERENCES_NAME}$`);
// Misma sección, pero rotulada dentro de la línea: «Referencias: Juan Pérez, …».
// Se busca en el texto original (sin tildes de por medio) para poder cortar la
// línea en el sitio exacto.
const REFERENCES_LABEL = new RegExp(`^\\s*${REFERENCES_NAME}\\s*:`, "i");
// Encabezados que cierran la sección, por si las referencias no son lo último.
const CLOSING_HEADINGS = new Set([
  "experiencia",
  "experiencia laboral",
  "experiencia profesional",
  "formacion",
  "formacion academica",
  "educacion",
  "estudios",
  "habilidades",
  "competencias",
  "conocimientos",
  "idiomas",
  "certificaciones",
  "cursos",
  "logros",
  "perfil",
  "perfil profesional",
  "resumen",
  "datos personales",
  "informacion personal",
]);
const MAX_HEADING_WORDS = 6;

/** Encabezado de sección: una línea corta, sin signos de cierre. */
function headingOf(line: string): string | null {
  const clean = normalizeForSearch(line).text.replace(/[:.;,•·|-]+$/, "").trim();
  if (!clean || clean.split(" ").length > MAX_HEADING_WORDS) return null;
  return clean;
}

/**
 * Oculta la sección de referencias con espacios de la misma longitud. Así se
 * deja de buscar términos ahí sin mover ni un índice: las citas de evidencia del
 * resto del CV siguen apuntando exactamente al mismo sitio del texto original.
 */
export function maskReferences(text: string): string {
  const lines = text.split("\n");
  const resultado = [...lines];
  let dentro = false;
  for (const [i, line] of lines.entries()) {
    const heading = headingOf(line);
    if (dentro) {
      // Otra sección del candidato cierra las referencias.
      if (heading !== null && CLOSING_HEADINGS.has(heading)) return resultado.join("\n");
      resultado[i] = " ".repeat(line.length);
      continue;
    }
    if (heading !== null && REFERENCES_HEADING.test(heading)) {
      dentro = true;
      resultado[i] = " ".repeat(line.length);
      continue;
    }
    const rotulo = REFERENCES_LABEL.exec(line);
    if (rotulo) {
      // Se conserva el rótulo y se oculta lo que lo sigue en la misma línea.
      resultado[i] = rotulo[0] + " ".repeat(line.length - rotulo[0].length);
      dentro = true;
    }
  }
  return dentro ? resultado.join("\n") : text;
}

export function evaluateWithRules(
  original: string,
  requirements: RequirementInput[],
  options: { referenceDate?: Date } = {},
): ItemAssessment[] {
  const referenceDate = options.referenceDate ?? new Date();
  const text = maskReferences(original);
  const haystack = normalizeForSearch(text);
  // Las líneas, secciones y entradas se calculan una sola vez y solo si algún requisito lo necesita.
  let index: ExperienceIndex | undefined;
  const experienceIndex = () => (index ??= buildExperienceIndex(text, referenceDate));
  return requirements.map((requirement) => evaluateRequirement(text, haystack, requirement, referenceDate, experienceIndex));
}
