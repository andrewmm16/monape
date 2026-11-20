import type { Enums, Tables } from "@/types/database";
import { buildInterviewGuide, type GuideItemInput, type GuideQuestion } from "./interview-guide";

/**
 * Preguntas para profundizar en la entrevista
 * (docs/superpowers/specs/2026-11-20-preguntas-profundizar-design.md).
 *
 * - «profundizar»: por cada requisito que el CV ya acredita, una pregunta para
 *   que la persona cuente con detalle su experiencia y cómo la respalda.
 * - «confirmar»: la IA reescribe las preguntas de la guía que eran plantilla.
 *
 * Las redacta la IA (cola `interview_deep_dives`); mientras no estén, o si la IA
 * no está disponible, se muestra una pregunta base por categoría. No cambian la
 * puntuación. Puro y determinista.
 */

export type DeepDiveKind = "profundizar" | "confirmar";

/** Pregunta guardada por la IA para un requisito. */
export type DeepDiveAiQuestion = { requirementId: string; kind: DeepDiveKind; question: string; listenFor: string | null };

export type DeepDiveQuestion = {
  requirementId: string;
  description: string;
  priority: Enums<"requirement_priority">;
  /** Lo que dice el CV (la primera cita), recortado. */
  quote: string | null;
  question: string;
  /** Qué escuchar en la respuesta. */
  listenFor: string;
  source: "ia" | "base";
};

/** Estados con la lista completa: la persona va a entrevista o ya la tuvo. */
export const FULL_DEEP_DIVE_STATUSES: readonly Enums<"application_status">[] = ["entrevista_programada", "en_evaluacion"];

const MAX_QUOTE = 200;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** Lo que la IA dejó en duda ya va en «Requisitos por confirmar». */
const doubtedByAi = (item: GuideItemInput) => item.ai?.assessment === "pendiente_verificacion" || item.ai?.assessment === "no_cumplido";

/** Acreditados, sin verificar por RRHH y sin duda de la IA; obligatorios primero, luego por peso y posición. */
export function selectDeepDiveItems(items: GuideItemInput[]): GuideItemInput[] {
  return items
    .filter((item) => item.assessment === "acreditado" && !item.verified && !doubtedByAi(item))
    .sort(
      (a, b) =>
        (a.priority === "obligatorio" ? 0 : 1) - (b.priority === "obligatorio" ? 0 : 1) ||
        b.weight - a.weight ||
        a.position - b.position,
    );
}

/** Preguntas de la guía que siguen siendo plantilla (la IA de evaluación no las redactó). */
export function confirmItemsWithoutAi(items: GuideItemInput[]): GuideQuestion[] {
  return buildInterviewGuide(items).filter((question) => question.source === "motor");
}

/**
 * ¿La evaluación vigente es de los criterios actuales y del CV vinculado? Si no,
 * sus citas no sirven: no se ofrece el botón (la base tampoco lo encola).
 */
export function isEvaluationCurrent(
  evaluation: { resumeId: string | null; criteriaVersion: number },
  current: { resumeId: string | null; criteriaVersion: number },
): boolean {
  return evaluation.criteriaVersion === current.criteriaVersion && (current.resumeId === null || evaluation.resumeId === current.resumeId);
}

/** ¿Hay algo que la IA pueda escribir? Si no, no se ofrece el botón (el trabajo se cerraría sin preguntas). */
export function deepDiveHasWork(items: GuideItemInput[]): boolean {
  return selectDeepDiveItems(items).length > 0 || confirmItemsWithoutAi(items).length > 0;
}

type BaseQuestion = { question: string; listenFor: string };

const EXPERIENCE: BaseQuestion = {
  question: "Su CV menciona esta experiencia. Cuénteme un caso concreto: qué tenía que resolver, qué hizo usted y qué resultado tuvo.",
  listenFor: "Detalles concretos (cifras, herramientas, fechas que coinciden con el CV) y lo que hizo la persona, no solo «el equipo».",
};
const TOOL: BaseQuestion = {
  question: "¿Qué es lo más complejo que ha hecho con esto? Descríbalo paso a paso.",
  listenFor: "Pasos concretos y del nivel que pide el puesto; sabe explicar por qué lo hizo así.",
};
const DOCUMENT: BaseQuestion = {
  question: "Pida el documento vigente. ¿En qué trabajo lo ha aplicado?",
  listenFor: "Presenta el documento y da un ejemplo de uso real.",
};

const BASE_BY_CATEGORY: Record<Enums<"requirement_category">, BaseQuestion> = {
  experiencia: EXPERIENCE,
  herramienta: TOOL,
  habilidad_tecnica: TOOL,
  idioma: {
    question: "Haga una parte de la entrevista en ese idioma.",
    listenFor: "Se comunica con el nivel que pide el puesto.",
  },
  certificacion: DOCUMENT,
  formacion: {
    question: "¿Qué de lo que estudió aplica hoy en su trabajo? Pida el documento si es clave.",
    listenFor: "Relaciona lo estudiado con tareas concretas.",
  },
  competencia: {
    question: "Cuénteme una situación en que lo demostró: qué pasó, qué hizo y qué resultado tuvo.",
    listenFor: "Un ejemplo propio y concreto, no una opinión general.",
  },
  otro: {
    question: "Cuénteme un ejemplo concreto o muestre un documento que lo respalde.",
    listenFor: "Un ejemplo o documento verificable.",
  },
};

function baseQuestion(item: GuideItemInput): BaseQuestion {
  return item.isEssential ? DOCUMENT : BASE_BY_CATEGORY[item.category];
}

function aiFor(ai: DeepDiveAiQuestion[], requirementId: string, kind: DeepDiveKind): DeepDiveAiQuestion | undefined {
  return ai.find((q) => q.requirementId === requirementId && q.kind === kind && q.question.trim().length > 0);
}

/** «Para profundizar»: una pregunta por requisito acreditado (de la IA si la hay; si no, la base). */
export function buildDeepDive(items: GuideItemInput[], ai: DeepDiveAiQuestion[]): DeepDiveQuestion[] {
  return selectDeepDiveItems(items).map((item) => {
    const base = baseQuestion(item);
    const written = aiFor(ai, item.requirementId, "profundizar");
    const quote = item.evidence.find((e) => e.quote.trim().length > 0)?.quote;
    return {
      requirementId: item.requirementId,
      description: item.description,
      priority: item.priority,
      quote: quote ? clip(quote, MAX_QUOTE) : null,
      question: written ? written.question.trim() : base.question,
      listenFor: written?.listenFor?.trim() || base.listenFor,
      source: written ? "ia" : "base",
    };
  });
}

/**
 * «Requisitos por confirmar»: las preguntas de plantilla se reemplazan por las
 * que la IA escribió para esta persona. Las redactadas por la IA de evaluación
 * no se tocan, y el «Cumple si» sigue siendo el de la metodología.
 */
export function applyConfirmQuestions(guide: GuideQuestion[], ai: DeepDiveAiQuestion[]): GuideQuestion[] {
  return guide.map((question) => {
    if (question.source !== "motor") return question;
    const written = aiFor(ai, question.requirementId, "confirmar");
    return written ? { ...question, question: written.question.trim(), source: "ia" } : question;
  });
}

/** Trabajo de preguntas tal como lo lee la página. */
export type DeepDiveRow = Pick<
  Tables<"interview_deep_dives">,
  | "id"
  | "status"
  | "origin"
  | "error_code"
  | "requested_at"
  | "available_at"
  | "attempts"
  | "resume_id"
  | "criteria_version"
  | "questions"
  | "finished_at"
>;

/**
 * Qué mostrar: `current`, el último completado con el mismo CV y criterios de la
 * evaluación vigente (sus preguntas en `aiQuestions`); `open`, uno en cola o en
 * proceso; `lastError`, el último fallido posterior a lo vigente, si no hay uno
 * abierto (sin los cierres silenciosos).
 */
export type DeepDiveState = {
  current: DeepDiveRow | null;
  open: DeepDiveRow | null;
  lastError: DeepDiveRow | null;
  aiQuestions: DeepDiveAiQuestion[];
};

/** Cierres que no son un error para RRHH: la persona ya no iba a entrevista o no había nada que preguntar. */
const SILENT_ERRORS = new Set(["fuera_de_entrevista", "sin_preguntas", "anonimizado"]);

function toAiQuestions(raw: unknown): DeepDiveAiQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): DeepDiveAiQuestion[] => {
    if (!entry || typeof entry !== "object") return [];
    const { requirement_id, kind, question, listen_for } = entry as Record<string, unknown>;
    if (typeof requirement_id !== "string" || (kind !== "profundizar" && kind !== "confirmar") || typeof question !== "string" || !question.trim()) {
      return [];
    }
    const listenFor = typeof listen_for === "string" && listen_for.trim() ? listen_for.trim() : null;
    return [{ requirementId: requirement_id, kind, question: question.trim(), listenFor }];
  });
}

export function pickDeepDiveState(rows: DeepDiveRow[], key: { resumeId: string | null; criteriaVersion: number }): DeepDiveState {
  const newestFirst = [...rows].sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at));
  const current =
    newestFirst.find((row) => row.status === "completado" && row.resume_id === key.resumeId && row.criteria_version === key.criteriaVersion) ?? null;
  const open = newestFirst.find((row) => row.status === "pendiente" || row.status === "procesando") ?? null;
  const failed = newestFirst.find((row) => row.status === "error" && !SILENT_ERRORS.has(row.error_code ?? ""));
  const lastError =
    !open && failed && (!current || Date.parse(failed.requested_at) > Date.parse(current.requested_at)) ? failed : null;
  return { current, open, lastError, aiQuestions: current ? toAiQuestions(current.questions) : [] };
}
