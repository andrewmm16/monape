import type { Enums } from "@/types/database";
import type { Assessment, EngineSignal, Evidence } from "./types";

/**
 * Guía de entrevista: para cada postulación, solo lo que falta confirmar, con la
 * pregunta a hacer, por qué se pregunta y qué respuesta cuenta como «cumple».
 *
 * - Entra lo que el CV no acredita (por confirmar, sin evidencia, no cumple) y lo
 *   que el motor acreditó pero la IA dejó en duda. Lo verificado por RRHH no entra.
 * - La pregunta la redacta la IA (ia-prompt-v5) cuando revisó ese CV; si no, una
 *   plantilla según la duda concreta del motor (`signal`) o la categoría.
 * - Orden: obligatorios primero; luego lo parcial (hay indicios) antes que lo que
 *   no aparece; luego el peso.
 *
 * Pura y determinista. Nunca descarta a nadie: solo ordena lo que hay que preguntar.
 */

export type GuideItemInput = {
  requirementId: string;
  description: string;
  category: Enums<"requirement_category">;
  priority: Enums<"requirement_priority">;
  weight: number;
  isEssential: boolean;
  minYears: number | null;
  /** Posición en la vacante (desempate estable). */
  position: number;
  assessment: Assessment;
  rationale: string;
  evidence: Evidence[];
  signal?: EngineSignal;
  /** RRHH ya lo verificó (entrevista, documento…): no va en la guía. */
  verified: boolean;
  /** Segunda opinión de la IA sobre este requisito, si la hubo. */
  ai?: { assessment: Assessment; rationale: string; question?: string | null } | null;
};

export type GuideQuestion = {
  requirementId: string;
  description: string;
  priority: Enums<"requirement_priority">;
  assessment: Assessment;
  /** «abierto»: el CV no lo acredita. «duda_ia»: el motor lo acreditó, pero la IA lo dejó en duda. */
  kind: "abierto" | "duda_ia";
  /** Por qué se pregunta (lo que vio el motor o la IA en el CV). */
  reason: string;
  question: string;
  /** Qué respuesta cuenta como «cumple». */
  passIf: string;
  /** Quién redactó la pregunta. */
  source: "ia" | "motor";
};

const MAX_REASON = 240;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

function yearsText(years: number): string {
  const value = Number.isInteger(years) ? String(years) : String(years).replace(".", ",");
  return `${value} ${years === 1 ? "año" : "años"}`;
}

/** El término del CV que originó la duda (tal como está escrito), si el motor lo guardó. */
function cvTerm(evidence: Evidence[]): string | null {
  for (const e of evidence) {
    const term = e.matched?.find((m) => m.trim().length > 1);
    if (term) return term.trim();
  }
  return null;
}

type Template = { question: string; passIf: string };

/** «Mínimo 3 años de experiencia en», «Manejo de», «Conocimiento de»…: lo que sobra al nombrar el tema. */
const TOPIC_LEAD =
  /^(?:(?:un\s+)?m[ií]nimo\s+(?:de\s+)?\d+(?:[.,]\d+)?\s+años?\s+de\s+)?(?:experiencia|conocimientos?|manejo|dominio|uso)\s+(?:en|de|con|como|sobre)\s+/i;

/**
 * El tema de un requisito para nombrarlo en una pregunta: «Mínimo 2 años de
 * experiencia en RRHH» → «RRHH», «Manejo de PLAME» → «PLAME». Los años y el
 * nivel siguen en el «Cumple si». Si no queda nada, el requisito completo.
 */
export function requirementTopic(description: string): string {
  const clean = description.replace(/\s+/g, " ").trim();
  const topic = clean.replace(TOPIC_LEAD, "").trim();
  return topic.length > 0 ? topic : clean;
}

/** El tema del requisito entre comillas: las preguntas siempre lo nombran (nunca «esto» ni «lo pedido»). */
function named(item: GuideItemInput): string {
  return `«${requirementTopic(item.description)}»`;
}

function fromSignal(item: GuideItemInput, signal: EngineSignal): Template {
  const req = named(item);
  const found = cvTerm(item.evidence);
  const term = found ? `«${found}»` : null;
  const years = item.minYears !== null ? ` durante al menos ${yearsText(item.minYears)}` : "";
  switch (signal) {
    case "negacion_explicita":
      return {
        question: `Su CV indica que no tiene ${req}. ¿Lo ha practicado después o de alguna otra forma? ¿Dónde y haciendo qué?`,
        passIf: `Describe una experiencia propia y concreta en ${req}.`,
      };
    case "nivel_inferior":
      return {
        question: `Su CV declara un nivel menor del que pide ${req}. ¿Qué es lo más avanzado que ha hecho con ${term ?? req}? Pida un ejemplo concreto.`,
        passIf: `El ejemplo corresponde al nivel que pide ${req}.`,
      };
    case "nivel_no_declarado":
      return {
        question: `¿Qué nivel maneja de ${term ?? req}? Pida un ejemplo de algo que haya hecho.`,
        passIf: `El ejemplo corresponde al nivel que pide ${req}.`,
      };
    case "cargo_relacionado":
      return {
        question: `${term ? `En su puesto de ${term}` : "En su puesto más parecido"}, ¿qué tareas de ${req} hacía usted y durante cuánto tiempo?`,
        passIf: `Las tareas que describe son de ${req}${years}, no solo parecidas.`,
      };
    case "habilidad_relacionada":
      return {
        question: term
          ? `Su CV menciona ${term}, no exactamente ${req}. ¿Ha trabajado directamente con ${req}? ¿En qué tarea o proyecto?`
          : `Su CV no menciona ${req} de forma directa. ¿Ha trabajado con ${req}? ¿En qué tarea o proyecto?`,
        passIf: `Describe un uso propio de ${req}${term ? `, no solo de ${term}` : ""}.`,
      };
    case "mencion_dudosa":
      return {
        question: `¿Ha usado ${term ?? req} personalmente en su trabajo o estudios? ¿Dónde y para qué?`,
        passIf: `Usó ${term ?? req} personalmente; no es solo una mención o un interés.`,
      };
    case "fechas_no_cuadran":
      return {
        question: `Repase con la persona las fechas de inicio y fin de cada puesto con ${req}: ¿cuánto tiempo suma en total?`,
        passIf:
          item.minYears !== null
            ? `Las fechas suman al menos ${yearsText(item.minYears)} en ${req}.`
            : `Las fechas respaldan lo que declara el CV sobre ${req}.`,
      };
    case "solo_capacitacion":
      return {
        question: `Su CV muestra ${term ?? req} solo en un curso o capacitación. ¿Lo ha aplicado en un trabajo real? Pida un ejemplo.`,
        passIf: `Usó ${req} en un trabajo o proyecto real, no solo en el curso.`,
      };
    case "posible_errata":
      return {
        question: term
          ? `Su CV dice ${term}. ¿Se refiere a ${req}? ¿En qué lo ha usado?`
          : `Su CV parece mencionar ${req} con otra escritura. ¿Lo ha usado? ¿En qué?`,
        passIf: `Confirma experiencia propia con ${req}.`,
      };
  }
}

function fromCategory(item: GuideItemInput): Template {
  const req = named(item);
  const years = item.minYears !== null ? ` durante al menos ${yearsText(item.minYears)}` : "";
  if (item.isEssential) {
    return { question: `Pida el documento vigente que acredite ${req}.`, passIf: `Presenta el documento vigente de ${req}.` };
  }
  if (item.category === "competencia") {
    return {
      question: `Pida un ejemplo concreto en que haya demostrado ${req}: qué pasó, qué hizo y qué resultado tuvo.`,
      passIf: `Da un ejemplo propio y concreto de ${req}, no una opinión general.`,
    };
  }
  // Hay indicios en el CV (por confirmar, o acreditado que la IA dejó en duda): se pide precisar.
  const partial = item.assessment !== "sin_evidencia";
  if (item.minYears !== null || item.category === "experiencia") {
    return {
      question: partial
        ? `¿Cuánto tiempo ha trabajado en ${req} y haciendo qué? Pida las fechas de inicio y fin de cada puesto.`
        : `¿Ha trabajado en ${req}? ¿Dónde, haciendo qué y durante cuánto tiempo?`,
      passIf: `Describe experiencia propia en ${req}${years}.`,
    };
  }
  switch (item.category) {
    case "herramienta":
      return {
        question: partial
          ? `Su CV muestra ${req} solo en parte. ¿Qué ha hecho con ${req}? Pida un ejemplo concreto.`
          : `¿Ha usado ${req}? ¿Para qué y con qué frecuencia? Pida un ejemplo.`,
        passIf: `Ha usado ${req} en un trabajo o proyecto real, al nivel pedido.`,
      };
    case "formacion":
      return {
        question: `El puesto pide ${req}. ¿Qué estudios tiene, en qué institución y están concluidos? Pida el documento si es clave.`,
        passIf: `Acredita ${req} con estudios concluidos o el documento.`,
      };
    case "idioma":
      return {
        question: `El puesto pide ${req}. ¿Qué nivel tiene? Si es clave, haga una parte de la entrevista en ese idioma.`,
        passIf: `Se comunica con el nivel que pide ${req}.`,
      };
    case "certificacion":
      return { question: `¿Cuenta con ${req}? Pida el documento.`, passIf: `Presenta el documento vigente de ${req}.` };
    case "habilidad_tecnica":
      return {
        question: partial
          ? `Su CV muestra ${req} solo en parte. Pida un ejemplo concreto de algo que haya hecho en ${req}.`
          : `¿Ha trabajado en ${req}? Pida un ejemplo concreto de algo que haya hecho.`,
        passIf: `Da un ejemplo propio y concreto de ${req}, al nivel pedido.`,
      };
    default:
      return {
        question: `¿Cómo acredita ${req}? Pida un ejemplo o el documento que lo respalde.`,
        passIf: `Respalda ${req} con un ejemplo o un documento.`,
      };
  }
}

const OPEN_RANK: Record<Assessment, number> = {
  pendiente_verificacion: 0,
  sin_evidencia: 1,
  no_cumplido: 2,
  acreditado: 3,
};

/** ¿Va en la guía? Lo abierto y lo que la IA dejó en duda; nunca lo verificado por RRHH. */
function kindOf(item: GuideItemInput): GuideQuestion["kind"] | null {
  if (item.verified) return null;
  if (item.assessment !== "acreditado") return "abierto";
  const ai = item.ai?.assessment;
  return ai === "pendiente_verificacion" || ai === "no_cumplido" ? "duda_ia" : null;
}

export function buildInterviewGuide(items: GuideItemInput[]): GuideQuestion[] {
  const entries = items.flatMap((item) => {
    const kind = kindOf(item);
    if (!kind) return [];
    const template =
      item.signal && kind === "abierto" ? fromSignal(item, item.signal) : item.assessment === "no_cumplido" ? fromSignal(item, "negacion_explicita") : fromCategory(item);
    const aiQuestion = item.ai?.question?.trim();
    const reason =
      kind === "duda_ia"
        ? `El motor lo acreditó, pero la IA lo dejó en duda: ${item.ai!.rationale}`
        : aiQuestion && item.ai?.rationale
          ? item.ai.rationale
          : item.assessment === "sin_evidencia" && !item.signal
            ? `Su CV no menciona ${named(item)}.`
            : item.rationale;
    return [
      {
        item,
        question: {
          requirementId: item.requirementId,
          description: item.description,
          priority: item.priority,
          assessment: item.assessment,
          kind,
          reason: clip(reason, MAX_REASON),
          question: aiQuestion || template.question,
          passIf: template.passIf,
          source: aiQuestion ? "ia" : "motor",
        } satisfies GuideQuestion,
      },
    ];
  });
  entries.sort(
    (a, b) =>
      (a.item.priority === "obligatorio" ? 0 : 1) - (b.item.priority === "obligatorio" ? 0 : 1) ||
      OPEN_RANK[a.item.assessment] - OPEN_RANK[b.item.assessment] ||
      b.item.weight - a.item.weight ||
      a.item.position - b.item.position,
  );
  return entries.map((entry) => entry.question);
}
