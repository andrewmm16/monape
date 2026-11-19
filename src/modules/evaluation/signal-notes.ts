import { detectDateSignalNotes } from "./date-consistency";
import { describeVacancyCopy, findCopiedVacancyPhrases, VACANCY_COPY_NOTE_PREFIX } from "./vacancy-copy";

/**
 * Notas del CV ajenas a los requisitos, que se guardan al final de las
 * limitaciones de la evaluación: fechas (solapamientos, fechas imposibles y
 * rotación) y copia del aviso. Son para verificar en la entrevista; no cambian
 * el puntaje ni descartan a nadie. Módulo puro y determinista.
 */
export function detectEvaluationSignalNotes(fullText: string, vacancyText: string, referenceDate: Date): string[] {
  return [...detectDateSignalNotes(fullText, referenceDate), ...describeVacancyCopy(findCopiedVacancyPhrases(fullText, vacancyText))];
}

/**
 * Inicio de cada nota de señal. Deben coincidir con los textos de
 * `date-consistency.ts` y `vacancy-copy.ts` (lo comprueba la prueba unitaria).
 */
export const SIGNAL_NOTE_PREFIXES = [
  "Posibles fechas superpuestas en el historial laboral",
  "Fecha incoherente en el historial laboral",
  "El historial laboral muestra varios empleos de corta duración",
  VACANCY_COPY_NOTE_PREFIX,
] as const;

/**
 * Notas de señal de unas limitaciones ya guardadas. La reconstrucción tras una
 * verificación no vuelve a leer el CV, así que conserva las que ya tenía (antes
 * se perdían).
 */
export function storedSignalNotes(limitations: string[]): string[] {
  return limitations.filter((note) => SIGNAL_NOTE_PREFIXES.some((prefix) => note.startsWith(prefix)));
}
