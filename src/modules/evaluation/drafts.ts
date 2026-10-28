import { formatDate } from "@/lib/format";
import { APPLICATION_STATUS_LABELS, COMPATIBILITY_LEVEL_LABELS, EVALUATION_METHOD_LABELS } from "@/lib/labels";
import type { Enums, Tables } from "@/types/database";

/**
 * Borradores de texto a partir de una evaluación registrada, para que RRHH los
 * revise y edite antes de guardarlos. Son deterministas: solo usan los datos
 * de la evaluación, no inventan información y no recurren a servicios externos.
 *
 * Regla de redacción: «sin evidencia» se expresa como ausencia de mención en
 * el CV, nunca como incumplimiento; «aparentemente no cumplido» siempre se
 * presenta como algo por confirmar.
 */

export type DraftEvaluation = Pick<Tables<"candidate_evaluations">, "created_at" | "method" | "criteria_version" | "score" | "level"> & {
  resume: { version: number } | null;
  review_outcome?: Enums<"evaluation_review_outcome"> | null;
};

export type DraftItem = Pick<Tables<"candidate_evaluation_items">, "description" | "priority" | "assessment" | "is_essential">;

export type DraftInput = { evaluation: DraftEvaluation; items: DraftItem[]; currentCriteriaVersion: number };

type Status = Enums<"application_status">;

/** Longitud máxima del motivo de un cambio de estado (changeStatusSchema). */
export const REASON_MAX_LENGTH = 500;
/** Longitud máxima de una observación (changeStatusSchema y noteSchema). */
const NOTE_MAX_LENGTH = 4000;

const labelOf = (item: DraftItem) => (item.is_essential ? `${item.description} (legal o esencial)` : item.description);

/** Requisitos con esa valoración, los obligatorios primero. */
function select(items: DraftItem[], assessment: Enums<"requirement_assessment">, priority?: Enums<"requirement_priority">) {
  return items
    .filter((i) => i.assessment === assessment && (!priority || i.priority === priority))
    .sort((a, b) => Number(b.priority === "obligatorio") - Number(a.priority === "obligatorio"))
    .map(labelOf);
}

const percent = (value: number) => `${Math.round(value)} %`;

/** «A», «A y B», «A, B y C»; con más de `max` elementos, «A, B y N más». */
function humanList(values: string[], max = values.length): string {
  const shown = values.slice(0, Math.max(1, max));
  const rest = values.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} y ${rest} más`;
  if (shown.length === 1) return shown[0]!;
  const last = shown.at(-1)!;
  // «y» pasa a «e» ante una palabra que empieza con el sonido /i/ («e Inglés»).
  const conjunction = /^h?[iíIÍ](?![aeiouáéíóú])/.test(last) ? "e" : "y";
  return `${shown.slice(0, -1).join(", ")} ${conjunction} ${last}`;
}

function analyze({ items }: DraftInput) {
  const mandatory = items.filter((i) => i.priority === "obligatorio");
  return {
    mandatoryTotal: mandatory.length,
    met: select(items, "acreditado"),
    metMandatory: select(items, "acreditado", "obligatorio"),
    notMet: select(items, "no_cumplido"),
    notMetMandatory: select(items, "no_cumplido", "obligatorio"),
    missingMandatory: select(items, "sin_evidencia", "obligatorio"),
    missingDesirable: select(items, "sin_evidencia", "deseable"),
    pending: select(items, "pendiente_verificacion"),
  };
}

const isOutdated = ({ evaluation, currentCriteriaVersion }: DraftInput) => evaluation.criteria_version < currentCriteriaVersion;

function outdatedNote(input: DraftInput): string | null {
  return isOutdated(input)
    ? `Atención: esta evaluación usó los criterios v${input.evaluation.criteria_version}; los vigentes son v${input.currentCriteriaVersion}. Conviene reevaluar.`
    : null;
}

// --- Estado sugerido -----------------------------------------------------------

/** Estados en los que la compatibilidad orienta el siguiente paso. */
const SUGGESTION_FROM: readonly Status[] = ["nuevo", "en_revision"];

const SUGGESTION_BY_LEVEL: Record<Enums<"compatibility_level">, Status> = {
  alta: "preseleccionado",
  parcial: "en_revision",
  pendiente: "en_revision",
  // Solo se produce con requisitos aparentemente no cumplidos (ver scoring.ts).
  baja: "no_seleccionado",
};

export type StatusSuggestion = { status: Status; basis: string };

/**
 * Estado que la evaluación sugiere. Solo en las primeras etapas, y nunca con
 * una evaluación de criterios anteriores o marcada para reevaluar. RRHH lo
 * revisa y confirma: el cambio de estado sigue siendo una decisión humana.
 */
export function suggestStatus(input: DraftInput, current: Status): StatusSuggestion | null {
  const { evaluation } = input;
  if (!SUGGESTION_FROM.includes(current)) return null;
  if (isOutdated(input) || evaluation.review_outcome === "requiere_reevaluacion") return null;
  const status = SUGGESTION_BY_LEVEL[evaluation.level];
  if (status === current) return null;
  return {
    status,
    basis: `${COMPATIBILITY_LEVEL_LABELS[evaluation.level]} (${percent(evaluation.score)} acreditado) en la evaluación del ${formatDate(evaluation.created_at)}`,
  };
}

// --- Motivo --------------------------------------------------------------------

/**
 * Motivo del cambio de estado, en un párrafo y en lenguaje natural (≤ 500
 * caracteres). Explica la decisión con lo que la evaluación encontró en el CV.
 */
export function buildReasonDraft(input: DraftInput, status: Status): string {
  if (status === "retirado") return "La persona se retira del proceso. Motivo indicado:";
  if (status === "nuevo") return "Se devuelve al estado Nuevo. Motivo:";

  const a = analyze(input);
  const { evaluation } = input;
  const source = ` (Evaluación orientativa del ${formatDate(evaluation.created_at)}${
    isOutdated(input) ? `, con criterios v${evaluation.criteria_version}; los vigentes son v${input.currentCriteriaVersion}` : ""
  }.)`;

  const render = (max: number) => {
    const list = (values: string[]) => humanList(values, max);
    const strengths =
      a.mandatoryTotal > 0
        ? `el CV acredita ${a.metMandatory.length} de ${a.mandatoryTotal} requisitos obligatorios${a.metMandatory.length ? ` (${list(a.metMandatory)})` : ""}`
        : a.met.length > 0
          ? `el CV acredita ${list(a.met)}`
          : "el CV no acredita ninguno de los requisitos";
    const toConfirm = [...a.notMet, ...a.missingMandatory, ...a.pending];
    const notMet = a.notMet.length ? ` La evaluación indica que aparentemente no cumple ${list(a.notMet)}; debe confirmarse.` : "";
    const missing = a.missingMandatory.length ? ` Falta confirmar ${list(a.missingMandatory)}, que el CV no menciona.` : "";
    const pending = a.pending.length ? ` Queda por verificar ${list(a.pending)}.` : "";

    let body: string;
    switch (status) {
      case "preseleccionado":
        body = `Se preselecciona porque ${strengths}.${notMet}${missing}${pending}`;
        break;
      case "en_revision":
        body = `Pasa a revisión para analizar el CV con más detalle: ${COMPATIBILITY_LEVEL_LABELS[evaluation.level].toLowerCase()} (${percent(evaluation.score)} acreditado) y ${strengths}.${notMet}${missing}${pending}`;
        break;
      case "entrevista_programada":
        body = `${toConfirm.length ? `Se programa una entrevista para confirmar ${list(toConfirm)}.` : "Se programa una entrevista."} Según la evaluación, ${strengths}.`;
        break;
      case "en_evaluacion":
        body = `Pasa a evaluación. Según el análisis del CV, ${strengths}.${toConfirm.length ? ` Queda por confirmar ${list(toConfirm)}.` : ""}`;
        break;
      case "seleccionado":
        body = `Se selecciona tras completar el proceso. En el análisis del CV, ${strengths}.${toConfirm.length ? ` Durante el proceso debían confirmarse ${list(toConfirm)}.` : ""}`;
        break;
      case "en_reserva":
        body = `Queda en reserva para futuras oportunidades: ${strengths}.${notMet}${missing}`;
        break;
      case "no_seleccionado": {
        const gaps = [
          a.notMetMandatory.length ? `aparentemente no cumple ${list(a.notMetMandatory)} (pendiente de confirmar)` : null,
          a.missingMandatory.length ? `el CV no muestra evidencia de los requisitos obligatorios ${list(a.missingMandatory)}` : null,
        ].filter(Boolean);
        body = gaps.length
          ? `No se continúa con la candidatura porque ${gaps.join("; además, ")}.`
          : "No se continúa con la candidatura. El análisis del CV no muestra brechas en requisitos obligatorios; indique en qué se basa la decisión:";
        break;
      }
    }
    return `${body}${source}`;
  };

  for (let max = 8; max >= 1; max--) {
    const text = render(max);
    if (text.length <= REASON_MAX_LENGTH) return text;
  }
  return render(1).slice(0, REASON_MAX_LENGTH);
}

// --- Observación ---------------------------------------------------------------

/** Observación interna: resumen de la evaluación más reciente, en lista. */
export function buildObservationDraft(input: DraftInput, max = 15): string {
  const { evaluation } = input;
  const a = analyze(input);
  const cv = evaluation.resume ? `, CV v${evaluation.resume.version}` : "";
  const lines = [
    `Resumen de la evaluación del ${formatDate(evaluation.created_at)} (${EVALUATION_METHOD_LABELS[evaluation.method]}, criterios v${evaluation.criteria_version}${cv}): ${COMPATIBILITY_LEVEL_LABELS[evaluation.level]}, ${percent(evaluation.score)} del peso acreditado. Es orientativa.`,
  ];
  const add = (title: string, values: string[]) => {
    if (values.length === 0) return;
    lines.push("", `${title}:`, ...values.slice(0, max).map((v) => `- ${v}`));
    if (values.length > max) lines.push(`- y ${values.length - max} más`);
  };
  add("Acredita, con evidencia en el CV", a.met);
  add("Aparentemente no cumple (por confirmar)", a.notMet);
  add("No aparece en el CV, obligatorios (no significa que no lo cumpla)", a.missingMandatory);
  add("No aparece en el CV, deseables", a.missingDesirable);
  add("Para verificar en entrevista o con documentos", a.pending);

  const outdated = outdatedNote(input);
  if (outdated) lines.push("", outdated);
  return lines.join("\n");
}

/**
 * Observación del cambio de estado: el resumen de la evaluación más el
 * siguiente paso que corresponde al estado elegido.
 */
export function buildStatusNoteDraft(input: DraftInput, status: Status): string {
  if (status === "retirado" || status === "nuevo") return "";
  const a = analyze(input);
  const toConfirm = [...a.notMet, ...a.missingMandatory, ...a.pending];
  const nextStep: Partial<Record<Status, string>> = {
    preseleccionado: toConfirm.length
      ? `programar la entrevista y confirmar ${humanList(toConfirm, 5)}.`
      : "programar la entrevista.",
    en_revision: "revisar el CV completo y decidir si se preselecciona.",
    entrevista_programada: toConfirm.length ? `en la entrevista, confirmar ${humanList(toConfirm, 5)}.` : undefined,
    en_reserva: "tener en cuenta a la persona para vacantes similares.",
  };
  const step = nextStep[status];
  for (const max of [15, 8, 3]) {
    const text = buildObservationDraft(input, max) + (step ? `\n\nSiguiente paso: ${step}` : "");
    if (text.length <= NOTE_MAX_LENGTH) return text;
  }
  return buildObservationDraft(input, 1).slice(0, NOTE_MAX_LENGTH);
}

// --- Advertencias de coherencia ------------------------------------------------

const ADVANCING: readonly Status[] = ["preseleccionado", "entrevista_programada", "en_evaluacion", "seleccionado"];

/** Aviso cuando el estado elegido no concuerda con lo que muestra la evaluación. */
export function decisionWarning(input: DraftInput, status: Status): string | null {
  const a = analyze(input);
  if (status === "no_seleccionado" && a.notMetMandatory.length === 0 && a.missingMandatory.length === 0) {
    return "La evaluación no muestra brechas en requisitos obligatorios. Explique en el motivo en qué se basa la decisión.";
  }
  if (ADVANCING.includes(status) && a.notMetMandatory.length > 0) {
    return `La evaluación indica que aparentemente no cumple requisitos obligatorios (${humanList(a.notMetMandatory, 3)}). Confírmelo antes de pasar a «${APPLICATION_STATUS_LABELS[status]}».`;
  }
  if (status === "seleccionado" && a.missingMandatory.length > 0) {
    return `El CV no acredita ${humanList(a.missingMandatory, 3)}. Confirme que se verificó en la entrevista o con documentos.`;
  }
  if (isOutdated(input) && (status === "seleccionado" || status === "no_seleccionado" || status === "preseleccionado")) {
    return "La evaluación usó criterios anteriores a los vigentes. Conviene reevaluar antes de decidir.";
  }
  return null;
}
