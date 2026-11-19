import { DATE_NOTE_PREFIX } from "./date-consistency";
import { VACANCY_COPY_NOTE_PREFIX } from "./vacancy-copy";

/**
 * Otros puntos para aclarar en la entrevista, además de los requisitos de la
 * guía (`interview-guide.ts`). Son cosas que ya están marcadas en la postulación
 * y que solo se resuelven hablando con la persona:
 *
 * - las respuestas eliminatorias que no cumplen;
 * - las notas de señal que la evaluación guarda en sus limitaciones: fechas del
 *   CV (solapamientos, fechas imposibles y rotación) y CV que copia el aviso.
 *
 * Ninguno cambia la puntuación ni descarta a nadie. Las preguntas no tocan
 * características protegidas ni piden datos personales. Módulo puro y determinista.
 */

export type KillerAnswerInput = {
  id: string;
  meets: boolean;
  answer_boolean: boolean | null;
  answer_number: number | null;
  answer_text: string | null;
  question: { question: string } | null;
};

export type InterviewTopic = {
  id: string;
  kind: "eliminatoria" | NoteKind;
  title: string;
  /** Por qué se pregunta: lo que se ve en la postulación. */
  reason: string;
  question: string;
};

/** La respuesta tal como se muestra (Sí/No, el número o el texto). */
export function killerAnswerText(answer: Pick<KillerAnswerInput, "answer_boolean" | "answer_number" | "answer_text">): string {
  if (answer.answer_boolean !== null) return answer.answer_boolean ? "Sí" : "No";
  if (answer.answer_number !== null) return String(answer.answer_number);
  return answer.answer_text?.trim() || "—";
}

type NoteKind = keyof typeof DATE_NOTE_PREFIX | "copia_aviso";

/** Cada nota de señal, reconocida por su inicio fijo, con su título y su pregunta. */
const NOTE_TOPICS: { kind: NoteKind; prefix: string; title: string; question: string }[] = [
  {
    kind: "solapamiento",
    prefix: DATE_NOTE_PREFIX.solapamiento,
    title: "Fechas de trabajo que se superponen",
    question: "¿Trabajó en esos puestos al mismo tiempo? Repase con la persona las fechas de inicio y fin de cada uno.",
  },
  {
    kind: "fecha_imposible",
    prefix: DATE_NOTE_PREFIX.fecha_imposible,
    title: "Una fecha del historial que no cuadra",
    question: "Confirme las fechas de ese puesto: ¿cuándo empezó y cuándo terminó?",
  },
  {
    kind: "rotacion",
    prefix: DATE_NOTE_PREFIX.rotacion,
    title: "Varios empleos de corta duración",
    question:
      "Pídale que le cuente su trayectoria: qué hacía en cada puesto y qué buscaba con cada cambio. No pregunte por motivos personales ni de salud.",
  },
  {
    kind: "copia_aviso",
    prefix: VACANCY_COPY_NOTE_PREFIX,
    title: "Partes del CV copiadas del aviso",
    question: "Pídale que le cuente, con sus palabras y con un ejemplo concreto, cómo hacía esas funciones y en qué puesto.",
  },
];

export function buildInterviewTopics(input: { killerAnswers: KillerAnswerInput[]; limitations: string[] }): InterviewTopic[] {
  const killer = input.killerAnswers.flatMap((answer): InterviewTopic[] => {
    if (answer.meets || !answer.question) return [];
    const question = answer.question.question.trim();
    return [
      {
        id: `eliminatoria-${answer.id}`,
        kind: "eliminatoria",
        title: question,
        reason: `Al postular respondió «${killerAnswerText(answer)}», que no cumple lo que pide la vacante.`,
        question: "Vuelva a hacerle esta pregunta y confirme su respuesta: ¿sigue siendo la misma o la entendió de otra forma?",
      },
    ];
  });

  const notes = input.limitations.flatMap((note, index): InterviewTopic[] => {
    const topic = NOTE_TOPICS.find((t) => note.startsWith(t.prefix));
    if (!topic) return [];
    return [{ id: `${topic.kind}-${index}`, kind: topic.kind, title: topic.title, reason: note, question: topic.question }];
  });

  return [...killer, ...notes];
}
