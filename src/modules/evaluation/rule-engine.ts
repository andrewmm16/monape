import { conjunctTerms } from "./conjunctions";
import { coreTerms, relatedListTerms } from "./related";
import { equivalentsFor } from "./synonyms";
import { buildExperienceIndex, estimateFromIndex, type ExperienceIndex } from "./experience-dates";
import {
  findTermOccurrences,
  isAspirationalMention,
  isCompanyNameMention,
  isLinkMention,
  isNegatedMention,
  isThirdPartyMention,
  isTrainingMention,
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
 *
 * Novedades de reglas-v6 (deterministas, sin servicios externos):
 *  - El nivel de una habilidad o herramienta se mide con una escalera de tres
 *    peldaños (básico < intermedio < avanzado), no con la antigua separación
 *    «básico vs. lo demás». Así un puesto que pide «avanzado» ya no queda
 *    cumplido con un «Excel intermedio»: se marca PARCIAL (pendiente), nunca «no
 *    cumplido». Se toma el nivel más alto que declara el CV frente al mínimo que
 *    pide la descripción (misma asimetría que la escalera de grados).
 *  - «Nivel usuario» en el requisito se trata como básico: un «Excel básico»
 *    sigue acreditando un requisito «a nivel usuario».
 *  - «Nociones de X» (conocimiento superficial declarado por la persona) queda
 *    pendiente de verificación aunque el requisito no fije nivel, si todas las
 *    menciones del término están así matizadas. «Básico» a secas sigue bastando
 *    cuando no se pide un nivel concreto.
 *
 * Novedades de reglas-v7 (deterministas, sin servicios externos):
 *  - Requisitos conjuntivos: cuando la descripción enumera varios términos unidos
 *    por «y» («S10 y MS Project», «PLE y PLAME»), el puesto los pide TODOS. Si el
 *    CV solo evidencia algunos, queda PARCIAL (pendiente), nunca acreditado. «O»
 *    sigue siendo alternativa: «WMS o SAP» se cumple con cualquiera.
 *  - Idiomas: se busca el idioma a secas aunque el término configurado traiga el
 *    nivel pegado («Inglés intermedio»), para que un CV que escribe «Inglés básico
 *    (A2)» coincida y la escalera del marco europeo pueda marcarlo por debajo.
 *  - Experiencia: si la persona DECLARA suficientes años pero las fechas del CV no
 *    los respaldan (al menos 2 años por debajo en su lectura más generosa), no se
 *    acredita por el texto: se marca pendiente y se avisa de la discrepancia, para
 *    que RRHH la verifique (CV posiblemente inflado).
 *
 * Novedades de reglas-v8 (deterministas, sin servicios externos):
 *  - Nivel por término base también en habilidades: «Excel avanzado» como término
 *    busca además «Excel», para que un «Excel básico» coincida y la escalera lo
 *    juzgue (lo que ya hacía idiomas).
 *  - Nivel no declarado: si el CV menciona la habilidad o el idioma SIN nivel y el
 *    puesto pide uno POR ENCIMA del básico, queda pendiente (se confirma en
 *    entrevista): no declarar el nivel no es declararlo bajo, pero tampoco lo
 *    acredita. Si el puesto solo pide «usuario/básico», mencionarlo basta.
 *  - Equivalencias también en herramientas, y «libros electrónicos» ≈ «PLE».
 *  - Categoría genérica vs concreta: si el CV solo declara la categoría (ERP) y el
 *    puesto pide la herramienta concreta (SAP), queda pendiente a verificar.
 *
 * Novedades de reglas-v9:
 *  - Rangos que parten de básico: «Excel básico-intermedio» frente a un puesto que
 *    pide intermedio lo cumple solo en parte → pendiente. Un rango que parte de
 *    intermedio («intermedio-avanzado») sigue contando como su extremo alto. Vale
 *    igual para habilidades e idiomas.
 *
 * Novedades de reglas-v10:
 *  - Evidencia relacionada (related.ts): si el CV no trae ningún término pedido
 *    pero sí un cargo parecido («asistente de residencia» frente a «residente de
 *    obra») o una habilidad más general («negociación» frente a «negociación de
 *    contratos»), queda PENDIENTE con esa pista en vez de «sin evidencia». Nunca
 *    acredita ni cambia el puntaje.
 *  - Cada duda concreta lleva una marca legible por código (`signal`, ver
 *    EngineSignal en types.ts) para que una segunda opinión sepa qué revisar.
 *
 * Novedades de reglas-v11 (puntos ciegos hallados con casos realistas):
 *  - No cuentan como evidencia: «me interesa…», la intención futura
 *    («próximamente», «planeo») ni el término dentro del NOMBRE DE UNA EMPRESA
 *    («Recepcionista en SAP Perú S.A.C.»).
 *  - Una herramienta o habilidad técnica que solo aparece en cursos o talleres queda
 *    pendiente: estudiarla no muestra que se haya usado.
 *  - Los años de una mención con su propia área («10 años de experiencia en ventas»)
 *    no se atribuyen a un término lejano de ella («…y conocimientos de contabilidad»).
 *  - Se reconocen: idiomas y niveles en inglés («English (fluent)»), abreviaturas
 *    de títulos («Ing. Civil»), «contador» como prueba de contabilidad (en un solo
 *    sentido) y posibles faltas de ortografía («Exel» → pendiente, nunca acreditado).
 */
export const RULE_ENGINE_VERSION = "reglas-v11";

const MAX_EVIDENCE = 3;
const YEARS_WINDOW = 160;
/**
 * Palabras como máximo entre «años de experiencia en» y el término para que esos
 * años sean de ese término: «en el área de contabilidad» (4) sí; «en ventas y
 * conocimientos de contabilidad» (5) no.
 */
const YEARS_AREA_WORDS = 4;
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
    requirement.category === "herramienta" ||
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

function wordsBetween(text: string, from: number, to: number): number {
  return text.slice(from, to).split(/\s+/).filter(Boolean).length;
}

/** Palabras que no identifican un área («en el sector de…»). */
const AREA_FILLER = new Set(["de", "del", "la", "las", "el", "los", "en", "como", "un", "una", "area", "sector", "rubro", "empresas", "empresa", "campo"]);

/**
 * Área que nombra una mención de años: hasta 4 palabras tras «en»/«como», cortando
 * en «y», coma o fin de oración («en ventas y conocimientos de…» → «ventas»).
 */
function yearsArea(after: string): string[] {
  const clause = after.replace(/^\s*(?:en|como)\s+/, "").split(/[,.;:\n]|\s(?:y|e)\s/)[0] ?? "";
  return clause
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, YEARS_AREA_WORDS)
    .filter((w) => w.length >= 4 && !AREA_FILLER.has(w));
}

/** ¿Alguna palabra del área comparte raíz (5 primeras letras) con el término? */
function sharesStem(area: string[], term: string): boolean {
  const stem = (w: string) => w.slice(0, 5);
  const termStems = new Set(term.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).map(stem));
  return area.some((w) => termStems.has(stem(w)));
}

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
        // reglas-v11: si la mención nombra su propia área («10 años de experiencia EN
        // ventas…») y el término viene después y lejos de ella («…y conocimientos de
        // contabilidad»), esos años son de otra área: no se atribuyen al término.
        // Solo cuando el término viene DESPUÉS y fuera del área, y esa área no comparte
        // raíz con él: «5 años de experiencia en supervisión de obras» sí vale para el
        // cargo «Supervisor de Obra» de más abajo; «en ventas» no vale para
        // «contabilidad». Si el término va ANTES («Asesor comercial con 3 años de
        // experiencia en ventas»), los años son de ese cargo, como siempre.
        const namesItsArea = /\b(?:en|como)$/.test(found[0].trimEnd()) || /^\s(?:en|como)\s/.test(haystack.text.slice(end, end + 7));
        if (namesItsArea && match.start >= end && wordsBetween(haystack.text, end, match.start) > YEARS_AREA_WORDS) {
          const area = yearsArea(haystack.text.slice(end, end + 80));
          if (!sharesStem(area, haystack.text.slice(match.start, match.end))) continue;
        }
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

/**
 * Escalera de nivel declarado para habilidades y herramientas (no idiomas), de
 * mayor a menor. A diferencia de BASIC_LEVEL/HIGHER_LEVEL —que solo separan
 * «básico» de «lo demás»— distingue los tres peldaños, para que un puesto que
 * pide «avanzado» no quede cumplido con un «intermedio». Es la misma asimetría
 * de la escalera de grados académicos: el requisito toma el mínimo que pide y el
 * CV el máximo que declara.
 */
// reglas-v11: también los niveles escritos en inglés («fluent», «native»,
// «beginner»). «Basic» no cuenta en «Visual Basic», que es un lenguaje.
const LEVEL_WORDS: ReadonlyArray<readonly [number, RegExp]> = [
  [3, /\b(?:avanzad[oa]s?|experto|experta|senior|advanced|fluido|fluida|nativ[oa]|fluent|native|proficient|expert)\b/],
  [2, /\b(?:intermedi[oa]s?|intermediate|conversational)\b/],
  [1, /\b(?:basic[oa]s?|inicial|principiante|elemental|nociones|beginner|elementary)\b|(?<!\bvisual )\bbasic\b/],
];
const LEVEL_NAMES: Record<number, string> = { 1: "básico", 2: "intermedio", 3: "avanzado" };
// «A nivel usuario» equivale a pedir un nivel básico. Solo se usa para leer el
// nivel que EXIGE el requisito, nunca el que declara el CV, para que un «Excel
// básico» siga acreditando un requisito «a nivel usuario».
const USER_LEVEL = /\b(?:a\s+)?nivel\s+usuario\b|\busuario\b/;
// «Nociones de X» es un conocimiento superficial declarado por la propia persona.
// Aunque el requisito no fije nivel, es un cumplimiento parcial a verificar. Es
// más débil que «básico», que sí basta cuando no se pide un nivel concreto.
const NOCIONES = /\bnociones\b/;

/** Nivel más alto declarado en un texto (3 avanzado … 1 básico), o null. */
function declaredSkillLevel(texto: string): number | null {
  for (const [nivel, patron] of LEVEL_WORDS) if (patron.test(texto)) return nivel;
  return null;
}

/** Nivel mínimo que exige una descripción de requisito, o null si no fija nivel. */
function requiredSkillLevel(texto: string): number | null {
  let minimo: number | null = null;
  for (const [nivel, patron] of LEVEL_WORDS) if (patron.test(texto) && (minimo === null || nivel < minimo)) minimo = nivel;
  if (USER_LEVEL.test(texto) && (minimo === null || minimo > 1)) minimo = 1;
  return minimo;
}

/** Nivel más bajo declarado en un texto, o null. Sirve para leer rangos («básico-intermedio»). */
function lowestSkillLevel(texto: string): number | null {
  let minimo: number | null = null;
  for (const [nivel, patron] of LEVEL_WORDS) if (patron.test(texto) && (minimo === null || nivel < minimo)) minimo = nivel;
  return minimo;
}

/**
 * Rango declarado que parte de básico y solo llega JUSTO al nivel pedido
 * («Excel básico-intermedio» frente a un puesto que pide intermedio): lo cumple a
 * medias, así que queda pendiente. Un rango que parte de intermedio
 * («intermedio-avanzado») sí cuenta como su extremo alto: es la forma habitual de
 * declarar un buen dominio (decisión de RRHH).
 */
function straddlesFromBasic(texto: string, requerido: number): boolean {
  return requerido > 1 && declaredSkillLevel(texto) === requerido && lowestSkillLevel(texto) === 1;
}

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
 * Idiomas que nombra un requisito (descripción + términos), para buscarlos a
 * secas. El término configurado suele traer el nivel pegado («Inglés intermedio»)
 * y entonces no coincide con un CV que escribe «Inglés básico (A2)»; añadir el
 * idioma deja que la escalera CEFR juzgue el nivel.
 */
function languageWordsIn(requirement: RequirementInput): string[] {
  const texto = normalizeTerm(`${requirement.description} ${requirement.keywords.join(" ")}`);
  const encontrados = new Set<string>();
  for (const m of texto.matchAll(new RegExp(LANGUAGE_WORDS.source, "g"))) {
    if (m[0] !== "idioma" && m[0] !== "idiomas") encontrados.add(m[0]);
  }
  const nombres = [...encontrados].map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  // reglas-v11: el nombre en inglés, para los CV escritos en inglés («English (fluent)»).
  for (const w of encontrados) {
    const ingles = LANGUAGE_IN_ENGLISH[w];
    if (ingles) nombres.push(ingles);
  }
  return nombres;
}

/** Nombre en inglés de cada idioma de LANGUAGE_WORDS (sin tildes, como se normaliza). */
const LANGUAGE_IN_ENGLISH: Record<string, string> = {
  ingles: "English",
  portugues: "Portuguese",
  frances: "French",
  italiano: "Italian",
  aleman: "German",
  chino: "Chinese",
  mandarin: "Mandarin",
  japones: "Japanese",
  coreano: "Korean",
  ruso: "Russian",
};

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

// Unión de las palabras de nivel, para separar el término base de una habilidad
// («Excel avanzado» → «Excel»). Global: se reutiliza y se resetea lastIndex.
const SKILL_LEVEL_WORDS =
  /\b(?:avanzad[oa]s?|experto|experta|senior|advanced|fluido|fluida|nativ[oa]|intermedi[oa]s?|intermediate|basic[oa]s?|inicial|principiante|elemental|nociones)\b/g;

/**
 * Términos base de las habilidades/herramientas cuyo keyword trae el nivel pegado
 * («Excel avanzado» → «Excel»), para que coincidan con un CV que escribe la
 * habilidad con otro nivel o sin él; el nivel lo juzga luego la escalera de 3
 * peldaños. Solo herramienta/habilidad: en otras categorías el «nivel» es incidental.
 */
function skillBaseTerms(requirement: RequirementInput, terms: string[]): string[] {
  if (requirement.category !== "herramienta" && requirement.category !== "habilidad_tecnica") return [];
  const out: string[] = [];
  for (const t of terms) {
    const norm = normalizeTerm(t);
    SKILL_LEVEL_WORDS.lastIndex = 0;
    if (!SKILL_LEVEL_WORDS.test(norm)) continue;
    SKILL_LEVEL_WORDS.lastIndex = 0;
    const base = norm.replace(SKILL_LEVEL_WORDS, " ").replace(/\s+/g, " ").trim();
    if (base.length >= 2 && !terms.some((x) => normalizeTerm(x) === base) && !out.includes(base)) out.push(base);
  }
  return out;
}

// Marco europeo a la escala de 3 peldaños: A→básico, B→intermedio, C→avanzado.
const CEFR_TIER = (c: number): number => (c <= 2 ? 1 : c <= 4 ? 2 : 3);

/**
 * Para idiomas: el CV ALCANZA el nivel pedido. Compara por el marco europeo (A2 <
 * B2) cuando ambos lados lo usan, para no perder B1 < B2; si no, lleva ambos a los
 * 3 peldaños (mezclando palabra y código). Si el CV no declara nivel, no alcanza.
 */
function languageMeets(reqDesc: string, text: string): boolean {
  const reqCefr = cefrLevel(reqDesc, "minimo");
  const cvCefr = cefrLevel(text, "maximo");
  if (reqCefr !== null && cvCefr !== null) return cvCefr >= reqCefr;
  const reqTier = reqCefr !== null ? CEFR_TIER(reqCefr) : requiredSkillLevel(reqDesc);
  const cvTier = cvCefr !== null ? CEFR_TIER(cvCefr) : declaredSkillLevel(text);
  if (reqTier === null || cvTier === null) return false;
  // «Inglés básico-intermedio» frente a «intermedio»: lo cumple a medias (ver straddlesFromBasic).
  if (cvCefr === null && straddlesFromBasic(text, reqTier)) return false;
  return cvTier >= reqTier;
}

/** Para idiomas: el CV declara ALGÚN nivel (código del marco europeo o palabra). */
function languageDeclaresLevel(text: string): boolean {
  return cefrLevel(text, "maximo") !== null || declaredSkillLevel(text) !== null;
}

/**
 * Categorías genéricas y las herramientas concretas que las instancian. Si el
 * requisito pide una concreta (SAP) y el CV solo menciona la categoría (ERP), el
 * candidato tiene «un» ERP pero no se prueba que sea el pedido: queda pendiente a
 * verificar, no acreditado (no es la misma evidencia) ni sin evidencia (sí declara algo).
 */
const GENERIC_CATEGORIES: ReadonlyArray<{ generico: string; especificos: readonly string[] }> = [
  { generico: "ERP", especificos: ["SAP", "SAP MM", "SAP FI", "SAP Business One", "Concar", "Oracle", "Dynamics", "Odoo"] },
];

/** Categorías genéricas a buscar porque el requisito pide una herramienta concreta de ellas. */
function genericTerms(requirement: RequirementInput): string[] {
  const keys = requirement.keywords.map(normalizeTerm);
  const out: string[] = [];
  for (const { generico, especificos } of GENERIC_CATEGORIES) {
    if (especificos.some((e) => keys.includes(normalizeTerm(e))) && !keys.includes(normalizeTerm(generico))) {
      out.push(generico);
    }
  }
  return out;
}

/**
 * Abreviaturas habituales de un título (reglas-v11), para los requisitos de
 * formación: «Ingeniería Civil» → «Ing. Civil», «Ingeniero Civil»; «Licenciatura en
 * Enfermería» → «Lic. en Enfermería», «Licenciada en Enfermería»; «Bachiller en X»
 * → «Bach. en X». La exigencia de estudios concluidos se aplica igual.
 */
function formationAbbreviations(term: string): string[] {
  const t = term.trim();
  const ingenieria = /^ingenier[ií]a\s+(.+)$/i.exec(t);
  if (ingenieria) {
    const x = ingenieria[1]!;
    return [`Ing. ${x}`, `Ing ${x}`, `Ingeniero ${x}`, `Ingeniera ${x}`];
  }
  const licenciatura = /^licenciatura\s+en\s+(.+)$/i.exec(t);
  if (licenciatura) {
    const x = licenciatura[1]!;
    return [`Lic. en ${x}`, `Lic. ${x}`, `Licenciado en ${x}`, `Licenciada en ${x}`];
  }
  const bachiller = /^bachiller(?:ato)?\s+en\s+(.+)$/i.exec(t);
  if (bachiller) return [`Bach. en ${bachiller[1]!}`, `Bach. ${bachiller[1]!}`];
  return [];
}

/**
 * Una coincidencia cuenta como evidencia del candidato salvo que esté negada,
 * exprese un interés o una intención futura, la atribuya a otra persona, forme
 * parte del nombre de una empresa (reglas-v11) o esté dentro de un correo o enlace.
 */
function countsAsEvidence(original: string, haystack: NormalizedText, m: Match): boolean {
  return (
    !isNegatedMention(original, haystack, m) &&
    !isAspirationalMention(original, haystack, m) &&
    !isThirdPartyMention(original, haystack, m) &&
    !isCompanyNameMention(original, haystack, m) &&
    !isLinkMention(original, haystack, m)
  );
}

/** ¿`a` y `b` están a una edición (inserción, borrado, cambio o trasposición)? */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    // Cambio de una letra, o dos letras traspuestas («Excle» por «Excel»).
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  return shorter.slice(i) === longer.slice(i + 1);
}

/** Longitud mínima de un término para buscarle faltas de ortografía. */
const TYPO_MIN_LENGTH = 5;

/**
 * Posible falta de ortografía (reglas-v11): el CV no trae el término pero sí una
 * palabra a una sola edición de él («Exel» por «Excel», «Pyton» por «Python»).
 * Solo términos de una palabra y de 5 letras o más, para no confundir palabras
 * cortas. Queda PENDIENTE, nunca acreditado: puede ser otra palabra.
 */
function typoEvidence(
  original: string,
  haystack: NormalizedText,
  requirement: RequirementInput,
  terms: string[],
): Omit<ItemAssessment, "requirementId"> | null {
  if (requirement.category === "idioma" || requirement.category === "competencia") return null;
  // Palabras de 4 letras o más: una letra de menos sobre un término de 5 («Exel»).
  const words = new Set(haystack.text.match(/\p{L}{4,}/gu) ?? []);
  const typos = new Map<string, string>();
  for (const term of terms) {
    const key = normalizeTerm(term);
    if (!/^\p{L}+$/u.test(key) || key.length < TYPO_MIN_LENGTH) continue;
    const variants = new Set(termVariants(term).map(normalizeTerm));
    for (const word of words) {
      if (!variants.has(word) && withinOneEdit(word, key) && !typos.has(word)) typos.set(word, term);
    }
  }
  if (typos.size === 0) return null;
  const found = collectMatches(haystack, [...typos.keys()]).filter((m) => countsAsEvidence(original, haystack, m));
  if (found.length === 0) return null;
  // Primera aparición de cada palabra, con su grafía original en el CV.
  const first = new Map<string, TermMatch>();
  for (const m of found) if (!first.has(m.term)) first.set(m.term, m);
  const shown = [...first.entries()]
    .slice(0, 3)
    .map(([word, m]) => `«${original.slice(haystack.map[m.start]!, haystack.map[m.end - 1]! + 1)}» (¿«${typos.get(word)}»?)`)
    .join(", ");
  return {
    assessment: "pendiente_verificacion",
    evidence: pickEvidence(original, haystack, found),
    rationale: `No aparece ninguno de los términos configurados (${terms.join(", ")}), pero el CV menciona ${shown}, que parece una falta de ortografía. Confírmelo al revisar el CV.`,
    signal: "posible_errata",
  };
}

/**
 * Evidencia relacionada (reglas-v10, ver related.ts): si el CV no trae ningún
 * término configurado pero sí un cargo o una habilidad PARECIDOS, el requisito
 * queda pendiente con esa pista en vez de «sin evidencia». Nunca acredita: un
 * cargo parecido no es el mismo cargo. Se descartan las menciones negadas, de
 * interés, de terceros o en enlaces, igual que con los términos configurados.
 */
function relatedEvidence(
  original: string,
  haystack: NormalizedText,
  requirement: RequirementInput,
  terms: string[],
  experienceIndex: () => ExperienceIndex,
): Omit<ItemAssessment, "requirementId"> | null {
  const listTerms = relatedListTerms(requirement);
  const cores = coreTerms(requirement);
  const candidates = [...listTerms];
  for (const core of cores.keys()) {
    if (!candidates.some((c) => normalizeTerm(c) === normalizeTerm(core))) candidates.push(core);
  }
  if (candidates.length === 0) return typoEvidence(original, haystack, requirement, terms);
  const valid = collectMatches(haystack, candidates).filter((m) => countsAsEvidence(original, haystack, m));
  // Una mención dentro de otra más larga («negociación» en «técnicas de negociación»)
  // no se cuenta aparte.
  const found = valid.filter(
    (m) => !valid.some((o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start),
  );
  if (found.length === 0) return typoEvidence(original, haystack, requirement, terms);

  const foundTerms = [...new Set(found.map((m) => m.term))];
  const label = (t: string) => (cores.has(t) ? `«${t}» (más general que «${cores.get(t)}»)` : `«${t}»`);
  const shown = foundTerms.slice(0, 3).map(label).join(", ");
  const searched = `No aparece ninguno de los términos configurados (${terms.join(", ")})`;
  const evidence = pickEvidence(original, haystack, found);

  if (requirement.category === "experiencia") {
    const dated = estimateFromIndex(experienceIndex(), foundTerms);
    const years =
      dated === null || dated.maxYears <= 0
        ? ""
        : dated.minYears === dated.maxYears
          ? ` (~${formatYears(dated.maxYears)} años según las fechas del CV)`
          : ` (entre ${formatYears(dated.minYears)} y ${formatYears(dated.maxYears)} años según las fechas del CV)`;
    const minimum = requirement.minYears !== null ? ` El mínimo pedido es ${formatYears(requirement.minYears)} años.` : "";
    return {
      assessment: "pendiente_verificacion",
      evidence,
      rationale: `${searched}, pero el CV menciona un cargo relacionado: ${shown}${years}. Es un cargo parecido, no el mismo: verifique si sus funciones equivalen a lo que pide el puesto.${minimum}`,
      signal: "cargo_relacionado",
    };
  }
  return {
    assessment: "pendiente_verificacion",
    evidence,
    rationale: `${searched}, pero el CV menciona algo relacionado: ${shown}. Es una pista, no lo mismo que pide el puesto: verifique el alcance real.`,
    signal: "habilidad_relacionada",
  };
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
  // Términos añadidos que son solo una categoría genérica (ERP), para distinguirlos
  // de los concretos al decidir el veredicto (ver el intercepto genérico más abajo).
  const genericos = new Set<string>();
  // Idiomas: añade el idioma a secas, porque el término configurado suele traer el
  // nivel pegado y así un «Inglés básico (A2)» no coincidiría (ver languageWordsIn).
  if (isLanguageRequirement(requirement)) {
    for (const idioma of languageWordsIn(requirement)) {
      if (!terms.some((t) => normalizeTerm(t) === normalizeTerm(idioma))) terms.push(idioma);
    }
  } else {
    // Habilidades/herramientas: busca el término base quitando la palabra de nivel
    // («Excel avanzado» → «Excel»), por lo mismo que en idiomas (ver skillBaseTerms).
    for (const skillBase of skillBaseTerms(requirement, terms)) terms.push(skillBase);
    // Categorías genéricas (ERP por SAP): se buscan para poder marcar pendiente si el
    // CV solo trae el genérico y no la herramienta concreta (ver intercepto abajo).
    for (const g of genericTerms(requirement)) {
      if (!terms.some((t) => normalizeTerm(t) === normalizeTerm(g))) {
        terms.push(g);
        genericos.add(normalizeTerm(g));
      }
    }
  }

  if (terms.length === 0) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence: [],
      rationale:
        "El requisito no tiene términos de búsqueda configurados, por lo que el motor de reglas no puede evaluarlo. Requiere revisión manual.",
    };
  }

  const expand = isEquivalenceScope(requirement)
    ? equivalentsFor
    : isFormationRequirement(requirement)
      ? formationAbbreviations
      : () => [];
  const allMatches = collectMatches(haystack, terms, expand);
  // «Sin experiencia en SAP» menciona el término pero no lo acredita.
  const matches = allMatches.filter((m) => countsAsEvidence(original, haystack, m));
  if (matches.length === 0 && allMatches.length > 0) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence: pickEvidence(original, haystack, allMatches),
      rationale: `El CV menciona: ${[...new Set(allMatches.map((m) => m.term))].join(", ")}, pero solo en frases que parecen negarlo, expresar un interés o una intención futura, atribuirlo a otra persona, como parte del nombre de una empresa o dentro de un correo o un enlace (por ejemplo «sin experiencia en…», «me interesa…», «mi equipo usaba…», «SAP Perú S.A.C.» o «concar.com.pe»). Revíselo en el CV.`,
      signal: "mencion_dudosa",
    };
  }
  if (matches.length === 0) {
    // Sin los términos pedidos, pero quizá con un cargo o una habilidad parecidos.
    const related = relatedEvidence(original, haystack, requirement, terms, experienceIndex);
    if (related) return { ...base, ...related };
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

  // Requisito conjuntivo: la descripción pide varios términos a la vez («S10 y MS
  // Project»). Si falta alguno en el CV, es un cumplimiento PARCIAL (pendiente),
  // nunca acreditado. Solo baja de nivel, así que es seguro.
  const conjuncts = conjunctTerms(requirement.description, terms);
  if (conjuncts.length >= 2) {
    const encontrados = new Set(matches.map((m) => m.term));
    const faltan = conjuncts.filter((t) => !encontrados.has(t));
    if (faltan.length > 0) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} Pero el puesto pide varios elementos a la vez (${conjuncts.join(" y ")}) y en el CV no aparece: ${faltan.join(", ")}. Verifique si la persona también domina ${faltan.join(", ")}.`,
      };
    }
  }

  // Genérico vs concreto: el CV solo menciona la categoría genérica (ERP) y no la
  // herramienta concreta que pide el requisito (SAP). Tiene «un» ERP pero no se
  // prueba que sea el pedido: pendiente a verificar (ver GENERIC_CATEGORIES).
  if (genericos.size > 0 && !matches.some((m) => !genericos.has(normalizeTerm(m.term)))) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence,
      rationale: `${foundText} Pero eso es una categoría genérica; el puesto pide una herramienta concreta (${requirement.keywords.join(", ")}). Verifique cuál usa la persona.`,
    };
  }

  // Herramienta o habilidad técnica que SOLO aparece en cursos o talleres
  // (reglas-v11): haberla estudiado no muestra que se haya usado en el trabajo.
  if (
    (requirement.category === "herramienta" || requirement.category === "habilidad_tecnica") &&
    matches.every((m) => isTrainingMention(original, haystack, m))
  ) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence,
      rationale: `${foundText} Pero solo aparece en cursos o capacitaciones: haberlo estudiado no muestra que lo haya usado en el trabajo. Verifique su experiencia práctica.`,
      signal: "solo_capacitacion",
    };
  }

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

  // Nivel declarado frente al que pide el puesto. El nivel se lee en el ítem de la
  // enumeración donde está el término, no en toda la oración: en «Excel (básico) y
  // Power BI avanzado» el «avanzado» es de Power BI.
  if (isLanguageRequirement(requirement)) {
    // Idiomas: el requisito se cumple solo si alguna mención ALCANZA el nivel pedido
    // (por el marco europeo, A2 < B2, con regreso a las palabras). Si ninguna lo
    // alcanza, queda pendiente, distinguiendo «por debajo» de «sin nivel declarado»:
    // no declarar el nivel no es declararlo bajo, pero tampoco acredita; se confirma
    // en entrevista.
    if (asksForHigherLevel(requirement)) {
      const reqDesc = normalizeTerm(requirement.description);
      const itemTexts = matches.map((m) => itemTextOf(original, haystack, m));
      if (!itemTexts.some((t) => languageMeets(reqDesc, t))) {
        const algunoDeclara = itemTexts.some(languageDeclaresLevel);
        return {
          ...base,
          assessment: "pendiente_verificacion",
          evidence,
          rationale: algunoDeclara
            ? `${foundText} Pero el nivel de idioma que declara el CV no alcanza del todo el que pide el puesto. Verifique el nivel real.`
            : `${foundText} Pero el CV no declara el nivel del idioma y el puesto pide un nivel concreto; confírmelo en la entrevista.`,
          signal: algunoDeclara ? "nivel_inferior" : "nivel_no_declarado",
        };
      }
    }
  } else {
    // Habilidades y herramientas: escalera de tres peldaños. Se toma el nivel más
    // alto declarado entre las coincidencias y se compara con el mínimo que pide
    // la descripción. Un nivel por debajo es PARCIAL (pendiente), nunca «no
    // cumplido»: el dominio real puede ser mayor de lo que el CV expresa.
    const required = requiredSkillLevel(normalizeTerm(requirement.description));
    const declaredMax = matches.reduce<number | null>((max, m) => {
      const nivel = declaredSkillLevel(itemTextOf(original, haystack, m));
      return nivel === null ? max : max === null ? nivel : Math.max(max, nivel);
    }, null);
    if (required !== null && declaredMax !== null && declaredMax < required) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} Pero el CV declara un nivel ${LEVEL_NAMES[declaredMax]} y el puesto pide un nivel ${LEVEL_NAMES[required]} o superior. Verifique el nivel real.`,
        signal: "nivel_inferior",
      };
    }
    // Rango que parte de básico y solo llega justo a lo pedido («básico-intermedio»
    // frente a intermedio): si ninguna mención lo cumple de lleno, queda PARCIAL.
    if (
      required !== null &&
      declaredMax !== null &&
      declaredMax >= required &&
      !matches.some((m) => {
        const item = itemTextOf(original, haystack, m);
        const alto = declaredSkillLevel(item);
        return alto !== null && alto >= required && !straddlesFromBasic(item, required);
      })
    ) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} Pero el CV declara un rango que parte de básico y llega justo a ${LEVEL_NAMES[required]}, el nivel que pide el puesto: lo cumple solo en parte. Confírmelo en la entrevista.`,
        signal: "nivel_inferior",
      };
    }
    // El CV menciona la habilidad pero NO su nivel, y el puesto pide uno POR ENCIMA
    // del básico: no se da por cumplido; el nivel se confirma en entrevista (igual
    // que en idiomas). Si el puesto solo pide «usuario/básico» (el piso), mencionar
    // la herramienta ya basta y no se exige el nivel.
    if (
      required !== null &&
      required >= 2 &&
      declaredMax === null &&
      (requirement.category === "herramienta" || requirement.category === "habilidad_tecnica")
    ) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} Pero el CV no declara el nivel y el puesto pide un nivel ${LEVEL_NAMES[required]} o superior; confírmelo en la entrevista.`,
        signal: "nivel_no_declarado",
      };
    }
    // Sin nivel exigido, pero la persona lo declara solo como «nociones» en todas
    // sus menciones: conocimiento superficial que conviene verificar. «Básico» a
    // secas sí basta cuando el requisito no pide un nivel.
    if (required === null && matches.every((m) => NOCIONES.test(itemTextOf(original, haystack, m)))) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence,
        rationale: `${foundText} Pero el CV lo declara solo como «nociones», un conocimiento general que conviene verificar.`,
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
    // reglas-v11: también las equivalencias que coincidieron («Contador General
    // 2018 – actualidad» suma años de contabilidad), no solo los términos configurados.
    const equivalentes = [...new Set(matches.flatMap((m) => (m.via === undefined ? [] : [m.via])))];
    const dated = estimateFromIndex(experienceIndex(), [...terms, ...equivalentes]);
    const minimum = formatYears(required);
    const byMention = years !== null && years >= required;
    const byDates = dated !== null && dated.minYears >= required;
    // Discrepancia: declara años suficientes pero las fechas no los respaldan (al
    // menos 2 años menos aun en su lectura más generosa). No se acredita por el
    // texto: pendiente y aviso, para que RRHH verifique un CV posiblemente inflado.
    const datesContradict = years !== null && dated !== null && years - dated.maxYears >= 2;

    if (datesContradict) {
      return {
        ...base,
        assessment: "pendiente_verificacion",
        evidence: dated!.quotes.length > 0 ? dated!.quotes : mentionEvidence,
        rationale: `${foundText} Declara ${formatYears(years!)} años de experiencia, pero las fechas del CV suman como mucho ~${formatYears(dated!.maxYears)} años (calculado al ${formatDate(referenceDate)}; mínimo: ${minimum}). Puede haber experiencia sin fechas o una inconsistencia en el CV: verifíquelo antes de darlo por cumplido.`,
        signal: "fechas_no_cuadran",
      };
    }

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
