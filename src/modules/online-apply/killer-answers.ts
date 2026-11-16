import type { PublicKillerQuestion } from "@/modules/public-jobs/types";

/** Prefijo del campo del formulario: `kq_<id de la pregunta>`. */
export const KILLER_FIELD_PREFIX = "kq_";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^-?\d{1,10}([.,]\d{1,2})?$/;

export function killerFieldId(questionId: string): string {
  return `${KILLER_FIELD_PREFIX}${questionId}`;
}

/** Respuestas crudas del formulario, por id de pregunta (ignora cualquier otro campo). */
export function collectKillerFields(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith(KILLER_FIELD_PREFIX) || typeof value !== "string") continue;
    const id = key.slice(KILLER_FIELD_PREFIX.length);
    if (UUID.test(id) && Object.keys(raw).length < 50) raw[id.toLowerCase()] = value.trim();
  }
  return raw;
}

export type KillerAnswerPayload = {
  question_id: string;
  answer_boolean?: boolean;
  answer_number?: number;
  answer_text?: string;
};

/**
 * Convierte las respuestas crudas en el jsonb que recibe el RPC. Solo valida la
 * FORMA (obligatoria, tipo, opción existente): si la respuesta cumple o no lo
 * decide la base de datos y NUNCA impide enviar la postulación.
 */
export function buildKillerAnswers(
  questions: PublicKillerQuestion[],
  raw: Record<string, string>,
): { answers: KillerAnswerPayload[]; errors: Record<string, string[]> } {
  const answers: KillerAnswerPayload[] = [];
  const errors: Record<string, string[]> = {};
  for (const q of questions) {
    const value = raw[q.id.toLowerCase()] ?? "";
    const field = killerFieldId(q.id);
    if (value === "") {
      if (q.required) errors[field] = ["Responda esta pregunta."];
      continue;
    }
    if (q.type === "si_no") {
      if (value !== "si" && value !== "no") errors[field] = ["Elija Sí o No."];
      else answers.push({ question_id: q.id, answer_boolean: value === "si" });
    } else if (q.type === "numero") {
      if (!NUMBER.test(value)) errors[field] = ["Ingrese un número válido."];
      else answers.push({ question_id: q.id, answer_number: Number(value.replace(",", ".")) });
    } else if (!q.options.includes(value)) {
      errors[field] = ["Elija una de las opciones."];
    } else {
      answers.push({ question_id: q.id, answer_text: value });
    }
  }
  return { answers, errors };
}
