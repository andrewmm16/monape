import { buildExperienceIndex, estimateFromIndex, type ExperienceIndex } from "./experience-dates";
import { excerpt, findTermOccurrences, normalizeForSearch, normalizeTerm, type Match, type NormalizedText } from "./text";
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
 */
export const RULE_ENGINE_VERSION = "reglas-v2";

const MAX_EVIDENCE = 3;
const YEARS_WINDOW = 160;
// Solo cuentan años expresados como experiencia («5 años de experiencia»,
// «experiencia de más de 3 años»). Así no se toman como experiencia la edad
// («26 años») ni la antigüedad de una empresa («empresa con 30 años»).
const EXPERIENCE_YEARS_PATTERNS = [
  /(\d{1,2}(?:[.,]\d)?)\s*\+?\s*(?:anos?|years?)\s+(?:de\s+|of\s+)?(?:experiencia|experience)\b/g,
  /(?:experiencia|experience)\s+(?:laboral\s+|profesional\s+)?(?:de\s+|of\s+)?(?:mas\s+de\s+|over\s+)?(\d{1,2}(?:[.,]\d)?)\s*\+?\s*(?:anos?|years?)\b/g,
];

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

function collectMatches(haystack: NormalizedText, terms: string[]): TermMatch[] {
  return terms
    .flatMap((term) => findTermOccurrences(haystack, term).map((m) => ({ ...m, term })))
    .sort((a, b) => a.start - b.start);
}

/** Prioriza términos distintos y evita extractos solapados. */
function pickEvidence(original: string, haystack: NormalizedText, matches: TermMatch[]): Evidence[] {
  const chosen: TermMatch[] = [];
  const usedTerms = new Set<string>();
  const overlaps = (m: TermMatch) => chosen.some((c) => Math.abs(c.start - m.start) < 120);
  for (const pass of [true, false]) {
    for (const match of matches) {
      if (chosen.length >= MAX_EVIDENCE) break;
      if (pass && usedTerms.has(match.term)) continue;
      if (overlaps(match)) continue;
      chosen.push(match);
      usedTerms.add(match.term);
    }
  }
  return chosen.sort((a, b) => a.start - b.start).map((m) => excerpt(original, haystack, m));
}

/**
 * Años de experiencia mencionados explícitamente cerca de las coincidencias.
 * Para cada coincidencia se toma la mención más próxima (no la mayor), de modo
 * que una cifra referida a otra experiencia del CV no se atribuya a esta.
 */
export function findYearsNear(haystack: NormalizedText, matches: Match[]): number | null {
  let best: number | null = null;
  for (const match of matches) {
    const from = Math.max(0, match.start - YEARS_WINDOW);
    const to = Math.min(haystack.text.length, match.end + YEARS_WINDOW);
    const windowText = haystack.text.slice(from, to);
    const anchor = match.start - from;
    let nearest: { value: number; distance: number } | null = null;
    for (const pattern of EXPERIENCE_YEARS_PATTERNS) {
      for (const found of windowText.matchAll(pattern)) {
        const value = Number.parseFloat(found[1]!.replace(",", "."));
        const distance = Math.abs((found.index ?? 0) - anchor);
        if (Number.isFinite(value) && value <= 50 && (nearest === null || distance < nearest.distance)) {
          nearest = { value, distance };
        }
      }
    }
    if (nearest && (best === null || nearest.value > best)) best = nearest.value;
  }
  return best;
}

function formatYears(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
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

  const matches = collectMatches(haystack, terms);
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
    const years = findYearsNear(haystack, matches);
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
            evidence,
            rationale: `${foundText} Se menciona ${formatYears(years)} años de experiencia. Al ser un requisito legal o esencial, debe verificarse con documentos.`,
          };
        }
        return {
          ...base,
          assessment: "acreditado",
          evidence,
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
