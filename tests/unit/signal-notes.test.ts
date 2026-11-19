import { describe, expect, it } from "vitest";
import { describeDateOverlaps, describeImpossibleRanges, describeJobHopping } from "@/modules/evaluation/date-consistency";
import { detectEvaluationSignalNotes, SIGNAL_NOTE_PREFIXES, storedSignalNotes } from "@/modules/evaluation/signal-notes";
import { describeVacancyCopy, findCopiedVacancyPhrases } from "@/modules/evaluation/vacancy-copy";

const cita = (quote: string) => ({ quote, start: 0, end: quote.length });
const AVISO =
  "Elaborar y controlar la planilla de remuneraciones, CTS y gratificaciones conforme a la normativa laboral vigente.";

describe("notas de señal del CV", () => {
  it("los prefijos coinciden con los textos reales de cada nota", () => {
    const notas = [
      ...describeDateOverlaps([{ first: cita("2019 - 2021"), second: cita("2020 - 2022"), months: 12 }]),
      ...describeImpossibleRanges([{ ...cita("2022 - 2019"), reason: "fin_antes_inicio" }]),
      ...describeJobHopping(5),
      ...describeVacancyCopy(findCopiedVacancyPhrases(`Experiencia\n${AVISO}`, AVISO)),
    ];
    expect(notas).toHaveLength(4);
    notas.forEach((nota, i) => expect(nota.startsWith(SIGNAL_NOTE_PREFIXES[i]!)).toBe(true));
  });

  it("une las notas de fechas y la de copia del aviso", () => {
    const cv = ["Experiencia laboral", "Asistente de RRHH", "2022 - 2019", AVISO].join("\n");
    const notas = detectEvaluationSignalNotes(cv, AVISO, new Date("2026-11-19T00:00:00Z"));
    expect(notas.map((n) => n.slice(0, 30))).toEqual([SIGNAL_NOTE_PREFIXES[1].slice(0, 30), SIGNAL_NOTE_PREFIXES[3].slice(0, 30)]);
  });

  it("al reconstruir conserva solo las notas de señal guardadas, en su orden", () => {
    const guardadas = [
      "La puntuación es orientativa: no es una probabilidad de contratación…",
      "El 20 % del peso corresponde a requisitos sin evidencia…",
      `${SIGNAL_NOTE_PREFIXES[3]} (2 tramos, 30 palabras), por ejemplo: «…».`,
      `${SIGNAL_NOTE_PREFIXES[0]}: el CV declara periodos que coinciden…`,
    ];
    expect(storedSignalNotes(guardadas)).toEqual([guardadas[2], guardadas[3]]);
    expect(storedSignalNotes([])).toEqual([]);
  });
});
