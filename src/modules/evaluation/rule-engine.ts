import { buildExperienceIndex, estimateFromIndex, type ExperienceIndex } from "./experience-dates";
import {
  findTermOccurrences,
  isAspirationalMention,
  isNegatedMention,
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
 */
export const RULE_ENGINE_VERSION = "reglas-v3";

const MAX_EVIDENCE = 3;
const YEARS_WINDOW = 160;
// Solo cuentan años expresados como experiencia («5 años de experiencia»,
// «experiencia de más de 3 años», «tres años como contador»). Así no se toman
// como experiencia la edad («26 años») ni la antigüedad de una empresa
// («empresa con 30 años en el mercado»).
const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20,
};
const NUM = "(\\d{1,2}(?:[.,]\\d)?|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte)(?:\\s*\\(\\d{1,2}\\))?";
const EXPERIENCE_YEARS_PATTERNS = [
  new RegExp(`\\b${NUM}\\s*\\+?\\s*(?:anos?|years?)\\s+(?:de\\s+|of\\s+)?(?:experiencia|experience|trayectoria|ejercicio|carrera|labor|practica)\\b`, "g"),
  new RegExp(`\\b(?:experiencia|experience)\\s+(?:laboral\\s+|profesional\\s+)?(?:de\\s+|of\\s+)?(?:mas\\s+de\\s+|over\\s+|al\\s+menos\\s+)?${NUM}\\s*\\+?\\s*(?:anos?|years?)\\b`, "g"),
  new RegExp(`\\b${NUM}\\s*\\+?\\s*anos?\\s+(?:como|trabajando|laborando|ejerciendo|desempenando|dedicad[oa])\\b`, "g"),
  new RegExp(`\\b${NUM}\\s*\\+?\\s*anos?\\s+en\\s+(?!el\\s+(?:mercado|mundo|pais)\\b)`, "g"),
];

function parseYears(token: string): number {
  return NUMBER_WORDS[token] ?? Number.parseFloat(token.replace(",", "."));
}

type TermMatch = Match & { term: string };

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

/** Cada término y sus variantes de número y género; `term` es siempre el término configurado. */
function collectMatches(haystack: NormalizedText, terms: string[]): TermMatch[] {
  const found = new Map<string, TermMatch>();
  for (const term of terms) {
    for (const variant of termVariants(term)) {
      for (const match of findTermOccurrences(haystack, variant)) {
        const key = `${term}|${match.start}|${match.end}`;
        if (!found.has(key)) found.set(key, { ...match, term });
      }
    }
  }
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

// Estudios sin terminar: no son un título.
const IN_PROGRESS = /\b(?:en curso|cursando|ciclo|semestre|estudiante|actualmente estudiando|trunc[oa]s?|inconclus[oa]s?)\b/;
const STUDY_CUES = /\b(?:bachiller|titul[oa]d[oa]?|titulo|licenciad[oa]|egresad[oa]|graduad[oa]|grado|maestria|magister|doctorad[oa]|diplomado|especializacion|posgrado|universidad|instituto|tecnic[oa]|ingenier[oa]|carrera|estudios?|facultad)\b/;
const BASIC_LEVEL = /\b(?:basic[oa]s?|inicial|principiante|elemental|nociones)\b/;
const HIGHER_LEVEL = /\b(?:intermedi[oa]s?|avanzad[oa]s?|experto|experta|senior|advanced|intermediate|fluido|fluida|nativ[oa])\b/;

/** Texto normalizado de la oración donde aparece la coincidencia. */
function sentenceTextOf(original: string, haystack: NormalizedText, match: Match): string {
  const { from, to } = sentenceBounds(original, haystack.map[match.start]!, haystack.map[match.end - 1]! + 1);
  return normalizeForSearch(original.slice(from, to)).text;
}

/** Requisito de estudios o título, por su categoría o por cómo está redactado. */
function isFormationRequirement(requirement: RequirementInput): boolean {
  if (requirement.category === "formacion") return true;
  return /\b(?:titulo|bachiller|titulad[oa]|licenciad[oa]|egresad[oa]|grado|maestria|diplomado|estudios)\b/.test(normalizeTerm(requirement.description));
}

function asksForHigherLevel(requirement: RequirementInput): boolean {
  return /\b(?:intermedi[oa]s?|avanzad[oa]s?|advanced|intermediate|experto|senior)\b/.test(normalizeTerm(requirement.description));
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

  const allMatches = collectMatches(haystack, terms);
  // «Sin experiencia en SAP» menciona el término pero no lo acredita.
  const matches = allMatches.filter((m) => !isNegatedMention(original, haystack, m) && !isAspirationalMention(original, haystack, m));
  if (matches.length === 0 && allMatches.length > 0) {
    return {
      ...base,
      assessment: "pendiente_verificacion",
      evidence: pickEvidence(original, haystack, allMatches),
      rationale: `El CV menciona: ${[...new Set(allMatches.map((m) => m.term))].join(", ")}, pero solo en frases que parecen negarlo o expresar un interés (por ejemplo «sin experiencia en…» o «interés en…»). Revíselo en el CV.`,
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
  const foundText = `El CV menciona: ${foundTerms.join(", ")}.`;

  // Formación: el término debe aparecer en una frase de estudios o título, no en
  // «con interés en Contabilidad» ni en el cargo («Asistente Contable»).
  if (requirement.minYears === null && isFormationRequirement(requirement)) {
    const studied = matches.filter((m) => {
      const text = sentenceTextOf(original, haystack, m);
      return STUDY_CUES.test(text) && !IN_PROGRESS.test(text);
    });
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
  if (asksForHigherLevel(requirement) && matches.length > 0) {
    const sentences = matches.map((m) => sentenceTextOf(original, haystack, m));
    if (sentences.every((text) => BASIC_LEVEL.test(text) && !HIGHER_LEVEL.test(text))) {
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

export function evaluateWithRules(
  text: string,
  requirements: RequirementInput[],
  options: { referenceDate?: Date } = {},
): ItemAssessment[] {
  const referenceDate = options.referenceDate ?? new Date();
  const haystack = normalizeForSearch(text);
  // Las líneas, secciones y entradas se calculan una sola vez y solo si algún requisito lo necesita.
  let index: ExperienceIndex | undefined;
  const experienceIndex = () => (index ??= buildExperienceIndex(text, referenceDate));
  return requirements.map((requirement) => evaluateRequirement(text, haystack, requirement, referenceDate, experienceIndex));
}
