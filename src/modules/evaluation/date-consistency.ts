import {
  buildExperienceIndex,
  findImpossibleDateRanges,
  type ExperienceIndex,
  type ImpossibleRange,
} from "./experience-dates";
import { maskReferences } from "./rule-engine";
import type { Evidence } from "./types";

/**
 * Señal de SOLAPAMIENTO de fechas en el historial laboral: cuando el CV declara
 * dos empleos que coinciden en el tiempo. No juzga al candidato ni cambia el
 * puntaje: produce una nota para que RRHH lo aclare en la entrevista (puede ser
 * pluriempleo legítimo o un error de fechas).
 *
 * Módulo PURO y determinista: reutiliza el índice de experiencia que ya calcula
 * `experience-dates.ts`, sin tocar el motor de puntuación.
 *
 * Detección CONSERVADORA. Cada periodo trae dos cotas por mes: `lo` (coexistencia
 * garantizada) y `hi` (máxima posible). Se marca solapamiento solo si la
 * intersección de los `lo` de dos empleos distintos es ≥ `MIN_OVERLAP_MONTHS`.
 * Así se evitan los falsos positivos de fechas con solo el año: dos empleos
 * secuenciales que comparten únicamente el año de transición no tienen `lo`
 * solapado, y dos empleos declarados con el mismo año colapsan a 1 mes (< umbral).
 * No se marcan huecos (ausencia de información, terreno de sesgo) ni fechas
 * imposibles (quedan para una fase posterior).
 */

/** Meses de coexistencia garantizada a partir de los cuales se considera un solapamiento real. */
const MIN_OVERLAP_MONTHS = 2;
/** Tope de notas para no inundar la evaluación. */
const MAX_NOTES = 5;

export type DateOverlap = { first: Evidence; second: Evidence; months: number };

type IndexLine = ExperienceIndex["lines"][number];
function lineEvidence(line: IndexLine): Evidence {
  return { quote: line.text, start: line.start, end: line.end };
}

/** Pares de empleos cuyos periodos coinciden en el tiempo con certeza (cota `lo`). */
export function findDateOverlaps(index: ExperienceIndex): DateOverlap[] {
  const { lines, entries } = index;
  const overlaps: DateOverlap[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      let best = 0;
      for (const p of entries[i]!.periods) {
        for (const q of entries[j]!.periods) {
          const months = Math.min(p.lo[1], q.lo[1]) - Math.max(p.lo[0], q.lo[0]) + 1;
          if (months > best) best = months;
        }
      }
      if (best >= MIN_OVERLAP_MONTHS) {
        overlaps.push({
          first: lineEvidence(lines[entries[i]!.lineIndex]!),
          second: lineEvidence(lines[entries[j]!.lineIndex]!),
          months: best,
        });
      }
    }
  }
  return overlaps;
}

/** Redacta cada solapamiento como una nota neutra para verificar en la entrevista. */
export function describeDateOverlaps(overlaps: DateOverlap[]): string[] {
  return overlaps
    .slice(0, MAX_NOTES)
    .map(
      (o) =>
        `Posibles fechas superpuestas en el historial laboral: el CV declara periodos que coinciden en el tiempo («${o.first.quote}» y «${o.second.quote}»). Puede ser pluriempleo legítimo o un error de fechas; conviene aclararlo en la entrevista.`,
    );
}

const IMPOSSIBLE_LABEL: Record<ImpossibleRange["reason"], string> = {
  fin_antes_inicio: "la fecha de fin es anterior a la de inicio",
  inicio_futuro: "la fecha de inicio es posterior a la fecha actual",
};

/** Redacta cada fecha imposible como una nota neutra para verificar en la entrevista. */
export function describeImpossibleRanges(ranges: ImpossibleRange[]): string[] {
  return ranges
    .slice(0, MAX_NOTES)
    .map(
      (r) =>
        `Fecha incoherente en el historial laboral («${r.quote}»): ${IMPOSSIBLE_LABEL[r.reason]}. Puede ser un error de tipeo; conviene aclararlo en la entrevista.`,
    );
}

/**
 * Notas sobre las fechas del CV (solapamientos e incoherencias), listas para
 * añadir a las limitaciones de la evaluación. No descartan a nadie.
 */
export function detectDateSignalNotes(original: string, referenceDate: Date): string[] {
  const masked = maskReferences(original);
  const index = buildExperienceIndex(masked, referenceDate);
  return [
    ...describeDateOverlaps(findDateOverlaps(index)),
    ...describeImpossibleRanges(findImpossibleDateRanges(masked, referenceDate)),
  ];
}
