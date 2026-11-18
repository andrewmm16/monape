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

function fromSignal(item: GuideItemInput, signal: EngineSignal): Template {
  const term = cvTerm(item.evidence);
  const years = item.minYears !== null ? ` durante al menos ${yearsText(item.minYears)}` : "";
  switch (signal) {
    case "negacion_explicita":
      return {
        question: "Su CV indica que no tiene esto. ¿Lo ha practicado después o de alguna otra forma? ¿Dónde?",
        passIf: "Describe una experiencia propia y concreta con lo pedido.",
      };
    case "nivel_inferior":
      return {
        question: `Su CV declara un nivel menor del que pide el puesto. ¿Qué es lo más avanzado que ha hecho${term ? ` con ${term}` : ""}? Pida un ejemplo concreto.`,
        passIf: "El ejemplo corresponde al nivel que pide el puesto.",
      };
    case "nivel_no_declarado":
      return {
        question: `¿Qué nivel${term ? ` de ${term}` : ""} maneja? Pida un ejemplo de algo que haya hecho.`,
        passIf: "El ejemplo corresponde al nivel que pide el puesto.",
      };
    case "cargo_relacionado":
      return {
        question: `${term ? `En su puesto de ${term}` : "En su puesto más parecido"}, ¿qué tareas de este tipo hacía usted y durante cuánto tiempo?`,
        passIf: `Las tareas que describe son las que pide el puesto${years}, no solo parecidas.`,
      };
    case "habilidad_relacionada":
      return {
        question: `Su CV menciona ${term ? `«${term}»` : "algo relacionado"}, no exactamente lo pedido. ¿Ha trabajado directamente con lo que pide el puesto? ¿En qué tarea o proyecto?`,
        passIf: "Describe un uso propio de lo pedido, no solo de algo parecido.",
      };
    case "mencion_dudosa":
      return {
        question: `¿Ha usado ${term ? `«${term}»` : "esto"} personalmente en su trabajo o estudios? ¿Dónde y para qué?`,
        passIf: "Lo usó personalmente; no es solo una mención o un interés.",
      };
    case "fechas_no_cuadran":
      return {
        question: "Repase con la persona las fechas de inicio y fin de cada puesto relacionado: ¿cuánto tiempo trabajó en esto?",
        passIf: item.minYears !== null ? `Las fechas suman al menos ${yearsText(item.minYears)}.` : "Las fechas respaldan lo que declara el CV.",
      };
    case "solo_capacitacion":
      return {
        question: "Su CV lo muestra en un curso o capacitación. ¿Lo ha aplicado en un trabajo real? Pida un ejemplo.",
        passIf: "Lo usó en un trabajo o proyecto real, no solo en el curso.",
      };
    case "posible_errata":
      return {
        question: `Su CV dice ${term ? `«${term}»` : "algo parecido"}. ¿Se refiere a lo que pide el puesto? ¿En qué lo ha usado?`,
        passIf: "Confirma experiencia propia con lo pedido.",
      };
  }
}

function fromCategory(item: GuideItemInput): Template {
  const years = item.minYears !== null ? ` durante al menos ${yearsText(item.minYears)}` : "";
  if (item.isEssential) {
    return { question: "Pida el documento que lo acredite (vigente).", passIf: "Presenta el documento vigente." };
  }
  if (item.category === "competencia") {
    return {
      question: "Pida un ejemplo concreto en que lo haya demostrado: qué pasó, qué hizo y qué resultado tuvo.",
      passIf: "Da un ejemplo propio y concreto, no una opinión general.",
    };
  }
  // Hay indicios en el CV (por confirmar, o acreditado que la IA dejó en duda): se pide precisar.
  const partial = item.assessment !== "sin_evidencia";
  if (item.minYears !== null || item.category === "experiencia") {
    return {
      question: partial
        ? "¿Cuánto tiempo ha trabajado en esto y haciendo qué? Pida las fechas de inicio y fin de cada puesto."
        : "¿Ha trabajado en esto? ¿Dónde, haciendo qué y durante cuánto tiempo?",
      passIf: `Describe experiencia propia en lo pedido${years}.`,
    };
  }
  switch (item.category) {
    case "herramienta":
      return {
        question: partial
          ? "Su CV lo muestra solo en parte. ¿Qué ha hecho con esta herramienta? Pida un ejemplo concreto."
          : "¿Ha usado esta herramienta? ¿Para qué y con qué frecuencia? Pida un ejemplo.",
        passIf: "La ha usado en un trabajo o proyecto real, al nivel que pide el puesto.",
      };
    case "formacion":
      return {
        question: "¿Qué estudios tiene relacionados con esto? ¿Están concluidos? Pida el documento si es clave.",
        passIf: "Tiene la formación que pide el puesto.",
      };
    case "idioma":
      return {
        question: "¿Qué nivel tiene? Si es clave para el puesto, haga una parte de la entrevista en ese idioma.",
        passIf: "Se comunica con el nivel que pide el puesto.",
      };
    case "certificacion":
      return { question: "¿Cuenta con esta certificación? Pida el documento.", passIf: "Presenta el documento vigente." };
    case "habilidad_tecnica":
      return {
        question: partial
          ? "Su CV lo muestra solo en parte. Pida un ejemplo concreto de algo que haya hecho en esto."
          : "¿Ha hecho esto en algún trabajo? Pida un ejemplo concreto de algo que haya hecho.",
        passIf: "Da un ejemplo propio y concreto, al nivel que pide el puesto.",
      };
    default:
      return {
        question: "¿Cumple con esto? Pida un ejemplo o el documento que lo respalde.",
        passIf: "Lo respalda con un ejemplo o un documento.",
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
            ? "Su CV no lo menciona."
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
