import { describe, expect, it } from "vitest";
import { DATE_NOTE_PREFIX, describeImpossibleRanges, describeJobHopping, detectDateSignalNotes } from "@/modules/evaluation/date-consistency";
import { buildInterviewTopics, killerAnswerText, type KillerAnswerInput } from "@/modules/evaluation/interview-topics";
import { VACANCY_COPY_NOTE_PREFIX } from "@/modules/evaluation/vacancy-copy";

const answer = (overrides: Partial<KillerAnswerInput> = {}): KillerAnswerInput => ({
  id: "k1",
  meets: false,
  answer_boolean: false,
  answer_number: null,
  answer_text: null,
  question: { question: "¿Tiene disponibilidad para trabajar en Lima?" },
  ...overrides,
});

describe("otros puntos para aclarar en la entrevista", () => {
  it("una respuesta eliminatoria que no cumple se vuelve a preguntar, con lo que respondió", () => {
    const [topic, ...rest] = buildInterviewTopics({ killerAnswers: [answer()], limitations: [] });
    expect(rest).toEqual([]);
    expect(topic).toMatchObject({
      id: "eliminatoria-k1",
      kind: "eliminatoria",
      title: "¿Tiene disponibilidad para trabajar en Lima?",
    });
    expect(topic!.reason).toContain("«No»");
  });

  it("las que cumplen y las de preguntas borradas no entran", () => {
    const topics = buildInterviewTopics({
      killerAnswers: [answer({ id: "ok", meets: true }), answer({ id: "borrada", question: null })],
      limitations: [],
    });
    expect(topics).toEqual([]);
  });

  it("reconoce las notas de fechas del motor y deja fuera las demás limitaciones", () => {
    const limitations = [
      "La evaluación es orientativa.",
      ...describeImpossibleRanges([{ quote: "2025 - 2019 Analista", start: 0, end: 20, reason: "fin_antes_inicio" }]),
      ...describeJobHopping(4),
    ];
    const topics = buildInterviewTopics({ killerAnswers: [], limitations });
    expect(topics.map((t) => t.kind)).toEqual(["fecha_imposible", "rotacion"]);
    expect(topics[0]!.reason).toBe(limitations[1]);
  });

  it("funciona con las notas reales que arma el motor a partir de un CV", () => {
    const cv = [
      "EXPERIENCIA",
      "Analista contable - Empresa A (marzo 2018 - diciembre 2021)",
      "Asistente contable - Empresa B (enero 2019 - junio 2022)",
    ].join("\n");
    const notes = detectDateSignalNotes(cv, new Date("2026-11-19T12:00:00Z"));
    expect(notes.length).toBeGreaterThan(0);
    const topics = buildInterviewTopics({ killerAnswers: [], limitations: notes });
    expect(topics.length).toBe(notes.length);
    expect(topics.every((t) => t.question.length > 0)).toBe(true);
  });

  it("reconoce la nota del CV que copia el aviso de la vacante", () => {
    const note = `${VACANCY_COPY_NOTE_PREFIX} (2, 31 palabras), por ejemplo: «elaborar las planillas y remuneraciones mensuales del personal». No es un motivo de descarte.`;
    const [topic, ...rest] = buildInterviewTopics({ killerAnswers: [], limitations: [note] });
    expect(rest).toEqual([]);
    expect(topic).toMatchObject({ kind: "copia_aviso", reason: note });
  });

  it("las preguntas nombran los puestos y las frases que cita la nota, no «ese puesto»", () => {
    const overlap = `${DATE_NOTE_PREFIX.solapamiento}: el CV declara periodos que coinciden en el tiempo («Analista contable - Empresa A (2018 - 2021)» y «Asistente contable - Empresa B (2019 - 2022)»). Puede ser pluriempleo legítimo o un error de fechas; conviene aclararlo en la entrevista.`;
    const impossible = describeImpossibleRanges([{ quote: "2025 - 2019 Analista", start: 0, end: 20, reason: "fin_antes_inicio" }]);
    const copy = `${VACANCY_COPY_NOTE_PREFIX} (2, 31 palabras), por ejemplo: «elaborar las planillas y remuneraciones mensuales del personal». No es un motivo de descarte.`;
    const [a, b, c] = buildInterviewTopics({ killerAnswers: [], limitations: [overlap, ...impossible, copy] });
    expect(a!.question).toContain("«Analista contable - Empresa A (2018 - 2021)»");
    expect(a!.question).toContain("«Asistente contable - Empresa B (2019 - 2022)»");
    expect(b!.question).toContain("«2025 - 2019 Analista»");
    expect(c!.question).toContain("«elaborar las planillas y remuneraciones mensuales del personal»");
    for (const topic of [a, b, c]) expect(topic!.question).not.toMatch(/\bese puesto\b|\besos puestos\b|\besas funciones\b/);
  });

  it("las preguntas sobre la trayectoria no invitan a hablar de salud ni de motivos personales", () => {
    const [topic] = buildInterviewTopics({ killerAnswers: [], limitations: describeJobHopping(3) });
    expect(topic!.question).toMatch(/No pregunte por motivos personales/);
  });

  it("muestra la respuesta como Sí/No, número o texto", () => {
    expect(killerAnswerText({ answer_boolean: true, answer_number: null, answer_text: null })).toBe("Sí");
    expect(killerAnswerText({ answer_boolean: null, answer_number: 3, answer_text: null })).toBe("3");
    expect(killerAnswerText({ answer_boolean: null, answer_number: null, answer_text: "  Turno noche " })).toBe("Turno noche");
    expect(killerAnswerText({ answer_boolean: null, answer_number: null, answer_text: null })).toBe("—");
  });
});
