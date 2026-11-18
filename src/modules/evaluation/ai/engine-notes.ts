import { detectKeywordStuffing, summarizeStuffing } from "@/modules/resumes/keyword-stuffing";
import { evaluateWithRules } from "../rule-engine";
import type { EngineSignal, ItemAssessment, RequirementInput } from "../types";
import { redactContactData } from "./redact";

/**
 * Notas del motor de reglas para la IA (prompt ia-prompt-v2).
 *
 * El motor es el actor principal; la IA es la segunda opinión en lo que el motor
 * no puede decidir solo. Para que la IA se enfoque en eso, cada requisito donde
 * el motor tuvo una duda concreta lleva una nota con la pregunta a resolver y lo
 * que el motor vio. Los requisitos que el motor acreditó sin dudas NO llevan
 * nota: la IA los revisa por su cuenta, sin el sesgo del motor (así sirve de
 * control de sus errores silenciosos).
 */

/** Pregunta concreta que la IA debe resolver para cada tipo de duda del motor. */
export const SIGNAL_QUESTIONS: Record<EngineSignal, string> = {
  cargo_relacionado:
    "El motor encontró un cargo parecido, no el pedido. Decide si sus funciones descritas equivalen a lo que pide el requisito.",
  habilidad_relacionada:
    "El motor encontró algo relacionado (más general o de la misma familia), no lo pedido. Decide si el CV acredita lo pedido o solo algo cercano.",
  mencion_dudosa:
    "La mención podría no ser experiencia o formación propia (un deseo, el nombre de una empresa, otro contexto). Decide si cuenta.",
  nivel_inferior: "El CV parece declarar un nivel menor que el pedido. Decide qué nivel acredita el CV.",
  nivel_no_declarado:
    "El CV menciona el tema sin indicar el nivel. Decide si las tareas o logros descritos acreditan el nivel pedido.",
  fechas_no_cuadran:
    "Los años declarados no cuadran con las fechas de los cargos. Calcula la experiencia con las fechas y decide.",
  solo_capacitacion:
    "Solo aparece como curso o capacitación, no como experiencia o dominio. Decide si eso basta para el requisito.",
  posible_errata: "El término aparece con una posible errata. Decide si se refiere a lo mismo que pide el requisito.",
};

const NO_KEYWORDS_QUESTION =
  "El motor no encontró los términos del requisito. Revisa si el CV lo describe con otras palabras (funciones, logros, herramientas equivalentes).";
const PENDING_QUESTION = "El motor encontró indicios, pero no bastan. Decide con lo que dice el CV.";

const MAX_RATIONALE = 320;
const MAX_QUOTES = 2;
const MAX_QUOTE = 160;

export type EngineNotes = {
  /** Nota por requisito (solo los que tienen una duda del motor). */
  perRequirement: Record<string, string>;
  /** Avisos sobre el CV en su conjunto (p. ej. posible relleno de palabras clave). */
  general: string[];
};

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** ¿El ítem del motor tiene una duda que conviene pasar a la IA? Lo verificado por RRHH ya no es duda. */
export function hasEngineDoubt(item: Pick<ItemAssessment, "assessment" | "signal" | "cvAssessment">): boolean {
  if (item.cvAssessment) return false;
  return Boolean(item.signal) || item.assessment === "pendiente_verificacion" || item.assessment === "sin_evidencia";
}

/**
 * Arma las notas a partir de las valoraciones del motor. Puro y determinista.
 * Las notas pasan por la misma redacción de datos de contacto que el CV.
 */
export function buildEngineNotes(items: ItemAssessment[], options: { stuffingWarning?: string | null } = {}): EngineNotes {
  const perRequirement: Record<string, string> = {};
  for (const item of items) {
    if (!hasEngineDoubt(item)) continue;
    const question = item.signal
      ? SIGNAL_QUESTIONS[item.signal]
      : item.assessment === "sin_evidencia"
        ? NO_KEYWORDS_QUESTION
        : PENDING_QUESTION;
    const quotes = item.evidence
      .slice(0, MAX_QUOTES)
      .map((e) => `«${clip(e.quote, MAX_QUOTE)}»`)
      .join(" · ");
    const seen = item.assessment === "sin_evidencia" && !item.signal ? "" : ` Lo que vio el motor: ${clip(item.rationale, MAX_RATIONALE)}`;
    const cites = quotes ? ` Citas del motor: ${quotes}` : "";
    perRequirement[item.requirementId] = redactContactData(`${question}${seen}${cites}`);
  }

  const general: string[] = [];
  if (options.stuffingWarning) {
    // El aviso de RRHH termina con consejos para la entrevista: a la IA solo le sirve el hallazgo.
    const finding = options.stuffingWarning.replace(/\.\s*Puede haberse escrito[\s\S]*$/, "");
    general.push(
      redactContactData(
        `${finding}. No acredites habilidades que solo aparecen en listas o repetidas sin respaldo en la experiencia o la formación: déjalas como pendiente_verificacion.`,
      ),
    );
  }
  return { perRequirement, general };
}

/**
 * Corre el motor sobre el texto (mismo motor y fecha que la evaluación de reglas)
 * y arma las notas para la IA. Determinista para una misma fecha de referencia.
 */
export function engineNotesForText(
  fullText: string,
  requirements: RequirementInput[],
  referenceDate: Date = new Date(),
): EngineNotes {
  const items = evaluateWithRules(fullText, requirements, { referenceDate });
  return buildEngineNotes(items, { stuffingWarning: summarizeStuffing(detectKeywordStuffing(fullText)) });
}
