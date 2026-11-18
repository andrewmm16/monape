import { normalizeTerm } from "./text";
import type { Assessment, ItemAssessment, RequirementInput } from "./types";

/**
 * Reglas aprendidas: lo que el motor aprendió de la IA (ver la migración
 * 20261118000200_motor_aprende.sql). Una regla dice que un término del CV
 * cuenta («equivale») o no cuenta («no_equivale») como lo que pide un
 * requisito. Se activan solas (votos de la IA en CV distintos, sin votos en
 * contra, más un segundo juez) y se suspenden solas si alguien las contradice.
 *
 * El motor sigue siendo determinista y explicable: la regla se aplica como una
 * palabra clave más del requisito («equivale») o quitando la duda de un cargo
 * relacionado que se sabe que no equivale («no_equivale»), y el motivo lo dice.
 * Nunca acredita requisitos legales o esenciales ni dice «no cumple».
 */

export type LearnedVerdict = "equivale" | "no_equivale";

export type LearnedRule = {
  id: string;
  requirementKey: string;
  /** Término normalizado (búsqueda). */
  term: string;
  /** Término tal como lo escribió el CV (para mostrar y para buscar como palabra clave). */
  termDisplay: string;
  verdict: LearnedVerdict;
};

/** Requisito al que aplica una regla: misma categoría y misma descripción (normalizada). */
export function requirementKey(requirement: Pick<RequirementInput, "category" | "description">): string {
  return `${requirement.category}:${normalizeTerm(requirement.description).replace(/\s+/g, " ").trim()}`;
}

/** Normaliza el término del CV que propone la IA: 1 a 6 palabras, 2 a 80 caracteres. Null si no sirve. */
export function normalizeLearnedTerm(raw: string): { term: string; display: string } | null {
  const display = raw.replace(/\s+/g, " ").trim().replace(/^[«"'“]+|[»"'”.,;:]+$/g, "").trim();
  const term = normalizeTerm(display).replace(/\s+/g, " ").trim();
  const words = term.split(" ").filter(Boolean);
  if (term.length < 2 || display.length > 80 || words.length === 0 || words.length > 6) return null;
  // Sin letras (fechas, cifras) no hay nada que aprender.
  if (!/[a-z]/.test(term)) return null;
  return { term, display };
}

/** Dudas del motor que una regla aprendida puede resolver (vocabulario, no juicio). */
export const LEARNABLE_SIGNALS = new Set(["cargo_relacionado", "habilidad_relacionada", "posible_errata"]);

/**
 * ¿Este voto de la IA sirve para aprender? Solo donde el motor tuvo una duda de
 * vocabulario (cargo o habilidad relacionada, errata, términos que no aparecen)
 * o donde aplicó una regla aprendida (control). El juicio caso a caso (nivel,
 * mención dudosa, fechas) no se convierte en regla. Donde no apareció nada,
 * solo sirve el «sí cuenta» (una paráfrasis encontrada): un «no cuenta» ahí no
 * resuelve ninguna duda del motor (medido con medir:ia: «Psicología» no cuenta
 * como Ingeniería Industrial, pero el motor ya lo dejaba sin evidencia).
 */
export function isLearnableVote(engineItem: ItemAssessment | undefined, equivalent = true): boolean {
  if (!engineItem || engineItem.cvAssessment) return false;
  if (engineItem.resolvedBy === "regla_aprendida") return true;
  if (engineItem.signal) return LEARNABLE_SIGNALS.has(engineItem.signal);
  return engineItem.assessment === "sin_evidencia" && equivalent;
}

const RANK: Record<Assessment, number> = { no_cumplido: 0, sin_evidencia: 1, pendiente_verificacion: 2, acreditado: 4 };

/** ¿`next` resuelve mejor el requisito que `base`? Acreditar, o quitar una duda del motor. */
function improves(base: ItemAssessment, next: ItemAssessment): boolean {
  const score = (item: ItemAssessment) => RANK[item.assessment] + (item.signal ? 0 : 1);
  return score(next) > score(base);
}

function matchedTerms(item: ItemAssessment): string[] {
  return item.evidence.flatMap((e) => e.matched ?? []).map((m) => normalizeTerm(m).replace(/\s+/g, " ").trim());
}

/**
 * Aplica las reglas activas de un requisito a la valoración del motor. Pura.
 * `reevaluate` vuelve a correr el motor con el requisito ampliado (mismas reglas
 * de siempre: años por fechas, niveles, menciones dudosas…).
 */
export function applyLearnedRules(
  base: ItemAssessment,
  requirement: RequirementInput,
  rules: LearnedRule[],
  reevaluate: (requirement: RequirementInput) => ItemAssessment,
): ItemAssessment {
  if (requirement.isEssential || rules.length === 0) return base;
  if (base.assessment === "acreditado" && !base.signal) return base;

  // «Equivale»: el término cuenta como una palabra clave más del requisito.
  const equivalent = rules.filter((r) => r.verdict === "equivale");
  if (equivalent.length > 0) {
    const extended = { ...requirement, keywords: [...requirement.keywords, ...equivalent.map((r) => r.termDisplay)] };
    const again = reevaluate(extended);
    if (improves(base, again)) {
      const found = matchedTerms(again);
      const used = equivalent.find((r) => found.some((m) => m.includes(r.term) || r.term.includes(m))) ?? equivalent[0]!;
      return {
        ...again,
        rationale: `${again.rationale} Regla aprendida: «${used.termDisplay}» cuenta como lo que pide este requisito (lo confirmó la IA en varios CV y un segundo juez).`,
        resolvedBy: "regla_aprendida",
        engineAssessment: base.assessment,
        learnedRuleId: used.id,
      };
    }
  }

  // «No equivale»: el cargo o la habilidad relacionada que dejó la duda no cuenta.
  // Queda por confirmar, pero ya no hace falta preguntarle a la IA.
  const notEquivalent = rules.filter((r) => r.verdict === "no_equivale");
  if (notEquivalent.length > 0 && (base.signal === "cargo_relacionado" || base.signal === "habilidad_relacionada")) {
    const found = matchedTerms(base);
    const covers = (m: string) => notEquivalent.find((r) => m === r.term || m.includes(r.term));
    if (found.length > 0 && found.every((m) => covers(m))) {
      const rule = covers(found[0]!)!;
      return {
        ...base,
        signal: undefined,
        rationale: `${base.rationale} Regla aprendida: «${rule.termDisplay}» no equivale a lo que pide este requisito; queda por confirmar en la entrevista.`,
        resolvedBy: "regla_aprendida",
        engineAssessment: base.assessment,
        learnedRuleId: rule.id,
      };
    }
  }
  return base;
}

/** Agrupa las reglas por requisito. */
export function groupLearnedRules(rules: LearnedRule[]): Map<string, LearnedRule[]> {
  const byKey = new Map<string, LearnedRule[]>();
  for (const rule of rules) byKey.set(rule.requirementKey, [...(byKey.get(rule.requirementKey) ?? []), rule]);
  return byKey;
}
