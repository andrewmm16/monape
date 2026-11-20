import { describe, expect, it } from "vitest";
import {
  applyConfirmQuestions,
  buildDeepDive,
  confirmItemsWithoutAi,
  deepDiveHasWork,
  FULL_DEEP_DIVE_STATUSES,
  isEvaluationCurrent,
  pickDeepDiveState,
  selectDeepDiveItems,
  type DeepDiveAiQuestion,
  type DeepDiveRow,
} from "@/modules/evaluation/deep-dive";
import { buildInterviewGuide, type GuideItemInput } from "@/modules/evaluation/interview-guide";

const item = (overrides: Partial<GuideItemInput> = {}): GuideItemInput => ({
  requirementId: "r1",
  description: "Gestión de planillas",
  category: "experiencia",
  priority: "obligatorio",
  weight: 5,
  isEssential: false,
  minYears: null,
  position: 0,
  assessment: "acreditado",
  rationale: "El CV lo menciona.",
  evidence: [{ quote: "Analista de planillas en Comercial Andina, 2019-2022" }],
  verified: false,
  ...overrides,
});

const ai = (overrides: Partial<DeepDiveAiQuestion> = {}): DeepDiveAiQuestion => ({
  requirementId: "r1",
  kind: "profundizar",
  question: "En Comercial Andina, ¿cómo cerraba la planilla de cada mes?",
  listenFor: "Pasos concretos y cifras.",
  ...overrides,
});

describe("preguntas para profundizar: qué entra", () => {
  it("entran solo los acreditados sin verificar y sin duda de la IA, obligatorios primero y luego por peso", () => {
    const selected = selectDeepDiveItems([
      item({ requirementId: "deseable-peso9", priority: "deseable", weight: 9, position: 0 }),
      item({ requirementId: "oblig-peso3", weight: 3, position: 1 }),
      item({ requirementId: "oblig-peso8", weight: 8, position: 2 }),
      item({ requirementId: "verificado", verified: true, position: 3 }),
      item({ requirementId: "por-confirmar", assessment: "pendiente_verificacion", position: 4 }),
      item({ requirementId: "duda-ia", ai: { assessment: "pendiente_verificacion", rationale: "No es claro." }, position: 5 }),
    ]);
    expect(selected.map((s) => s.requirementId)).toEqual(["oblig-peso8", "oblig-peso3", "deseable-peso9"]);
  });

  it("hay trabajo para la IA solo si algo entra en profundizar o queda una plantilla por confirmar", () => {
    expect(deepDiveHasWork([item()])).toBe(true);
    expect(deepDiveHasWork([item({ assessment: "sin_evidencia", evidence: [] })])).toBe(true);
    expect(deepDiveHasWork([item({ verified: true })])).toBe(false);
    expect(
      deepDiveHasWork([
        item({ assessment: "sin_evidencia", evidence: [], ai: { assessment: "sin_evidencia", rationale: "No aparece.", question: "¿Ya escrita?" } }),
      ]),
    ).toBe(false);
  });

  it("la evaluación está vigente solo con los criterios de la vacante y el CV vinculado", () => {
    const evaluation = { resumeId: "cv-1", criteriaVersion: 2 };
    expect(isEvaluationCurrent(evaluation, { resumeId: "cv-1", criteriaVersion: 2 })).toBe(true);
    expect(isEvaluationCurrent(evaluation, { resumeId: "cv-1", criteriaVersion: 3 })).toBe(false);
    expect(isEvaluationCurrent(evaluation, { resumeId: "cv-2", criteriaVersion: 2 })).toBe(false);
    // Sin CV vinculado a la postulación no hay con qué comparar: cuentan solo los criterios.
    expect(isEvaluationCurrent(evaluation, { resumeId: null, criteriaVersion: 2 })).toBe(true);
  });

  it("sin ítems devuelve listas vacías", () => {
    expect(selectDeepDiveItems([])).toEqual([]);
    expect(buildDeepDive([], [])).toEqual([]);
    expect(confirmItemsWithoutAi([])).toEqual([]);
  });

  it("solo entran en la entrevista completa los estados de entrevista", () => {
    expect([...FULL_DEEP_DIVE_STATUSES]).toEqual(["entrevista_programada", "en_evaluacion"]);
  });
});

describe("preguntas para profundizar: qué pregunta se muestra", () => {
  it("usa la pregunta de la IA de tipo profundizar y si no, la base por categoría con la cita del CV", () => {
    const longQuote = `Analista de planillas ${"x".repeat(300)}`;
    const questions = buildDeepDive(
      [item({ requirementId: "r1" }), item({ requirementId: "r2", category: "herramienta", description: "Excel", evidence: [{ quote: longQuote }] })],
      [ai({ requirementId: "r1" })],
    );
    expect(questions[0]).toMatchObject({
      requirementId: "r1",
      source: "ia",
      question: "En Comercial Andina, ¿cómo cerraba la planilla de cada mes?",
      listenFor: "Pasos concretos y cifras.",
      quote: "Analista de planillas en Comercial Andina, 2019-2022",
    });
    expect(questions[1]!.source).toBe("base");
    expect(questions[1]!.question).toBe("¿Qué es lo más complejo que ha hecho con «Excel»? Descríbalo paso a paso.");
    expect(questions[1]!.quote!.length).toBeLessThanOrEqual(200);
  });

  it("ninguna pregunta base es vaga: siempre nombra el requisito", () => {
    const VAGUE = /\b(esto|eso)\b|lo pedido|algo parecido|esta experiencia|lo demostró|lo que pide el puesto/i;
    const categories = ["formacion", "experiencia", "habilidad_tecnica", "herramienta", "certificacion", "competencia", "idioma", "otro"] as const;
    for (const input of [...categories.map((category) => item({ category })), item({ isEssential: true })]) {
      const [q] = buildDeepDive([input], []);
      expect(q!.question, input.category).not.toMatch(VAGUE);
      expect(q!.listenFor, input.category).not.toMatch(VAGUE);
      expect(q!.question, input.category).toContain("«Gestión de planillas»");
    }
  });

  it("la pregunta base de un requisito esencial pide el documento", () => {
    const [question] = buildDeepDive([item({ isEssential: true, category: "experiencia" })], []);
    expect(question!.question).toBe("Pida el documento vigente de «Gestión de planillas». ¿En qué trabajo lo ha aplicado?");
  });

  it("una pregunta de la IA sin «qué escuchar» usa el de la pregunta base", () => {
    const [question] = buildDeepDive([item()], [ai({ listenFor: null })]);
    expect(question!.source).toBe("ia");
    expect(question!.listenFor).toBe(
      "Detalles concretos de «Gestión de planillas» (cifras, herramientas, fechas que coinciden con el CV) y lo que hizo la persona, no solo «el equipo».",
    );
  });

  it("una pregunta de la IA de un requisito que ya no entra no se muestra", () => {
    const questions = buildDeepDive([item({ requirementId: "r1", verified: true })], [ai({ requirementId: "r1" })]);
    expect(questions).toEqual([]);
  });

  it("una pregunta de tipo confirmar no se usa como profundizar", () => {
    const [question] = buildDeepDive([item()], [ai({ kind: "confirmar" })]);
    expect(question!.source).toBe("base");
  });
});

describe("preguntas por confirmar que eran plantilla", () => {
  const open = (overrides: Partial<GuideItemInput> = {}) =>
    item({ assessment: "sin_evidencia", evidence: [], rationale: "El CV no lo menciona.", ...overrides });

  it("confirmItemsWithoutAi lista solo las que la IA de evaluación no redactó", () => {
    const items = [
      open({ requirementId: "plantilla" }),
      open({ requirementId: "con-ia", ai: { assessment: "sin_evidencia", rationale: "No aparece.", question: "¿Ha llevado planillas?" } }),
    ];
    expect(confirmItemsWithoutAi(items).map((q) => q.requirementId)).toEqual(["plantilla"]);
  });

  it("applyConfirmQuestions reemplaza solo las plantillas y conserva el Cumple si", () => {
    const guide = buildInterviewGuide([open({ requirementId: "r1" })]);
    const [updated] = applyConfirmQuestions(guide, [ai({ requirementId: "r1", kind: "confirmar", question: "¿Ha calculado planillas usted mismo? ¿En qué empresa?" })]);
    expect(updated).toMatchObject({ question: "¿Ha calculado planillas usted mismo? ¿En qué empresa?", source: "ia", passIf: guide[0]!.passIf });
  });

  it("una pregunta de la IA de evaluación (source ia) no se pisa", () => {
    const guide = buildInterviewGuide([
      open({ requirementId: "r1", ai: { assessment: "sin_evidencia", rationale: "No aparece.", question: "¿Pregunta de la evaluación?" } }),
    ]);
    const [kept] = applyConfirmQuestions(guide, [ai({ requirementId: "r1", kind: "confirmar", question: "¿Otra?" })]);
    expect(kept!.question).toBe("¿Pregunta de la evaluación?");
  });

  it("una pregunta de tipo profundizar no reemplaza una por confirmar", () => {
    const guide = buildInterviewGuide([open({ requirementId: "r1" })]);
    expect(applyConfirmQuestions(guide, [ai({ requirementId: "r1", kind: "profundizar" })])).toEqual(guide);
  });
});

describe("estado de las preguntas de la IA para la página", () => {
  const key = { resumeId: "cv-1", criteriaVersion: 2 };
  const job = (overrides: Partial<DeepDiveRow> = {}): DeepDiveRow => ({
    id: "d1",
    status: "completado",
    origin: "automatico",
    error_code: null,
    requested_at: "2026-11-20T10:00:00Z",
    available_at: "2026-11-20T10:00:00Z",
    attempts: 1,
    resume_id: "cv-1",
    criteria_version: 2,
    questions: [{ requirement_id: "r1", kind: "profundizar", question: "¿Cómo?", listen_for: "Detalles." }],
    finished_at: "2026-11-20T10:01:00Z",
    ...overrides,
  });

  it("vigente es el último completado con el mismo CV y criterios, y de ahí salen las preguntas", () => {
    const state = pickDeepDiveState(
      [job({ id: "nuevo-otro-cv", requested_at: "2026-11-20T12:00:00Z", resume_id: "cv-2" }), job({ id: "vigente" })],
      key,
    );
    expect(state.current?.id).toBe("vigente");
    expect(state.aiQuestions).toEqual([{ requirementId: "r1", kind: "profundizar", question: "¿Cómo?", listenFor: "Detalles." }]);
  });

  it("sin preguntas vigentes cuando cambió el CV o los criterios", () => {
    const state = pickDeepDiveState([job({ criteria_version: 1 })], key);
    expect(state.current).toBeNull();
    expect(state.aiQuestions).toEqual([]);
  });

  it("un trabajo abierto se informa y oculta el error anterior", () => {
    const state = pickDeepDiveState(
      [job({ id: "abierto", status: "pendiente", finished_at: null, requested_at: "2026-11-20T13:00:00Z" }), job({ id: "falló", status: "error", error_code: "respuesta_invalida" })],
      key,
    );
    expect(state.open?.id).toBe("abierto");
    expect(state.lastError).toBeNull();
  });

  it("el último error se muestra solo si es posterior a lo vigente y no es un cierre silencioso", () => {
    const failed = job({ id: "falló", status: "error", error_code: "demasiados_intentos", requested_at: "2026-11-20T12:00:00Z", questions: [] });
    expect(pickDeepDiveState([failed, job()], key).lastError?.id).toBe("falló");
    expect(pickDeepDiveState([job({ requested_at: "2026-11-20T13:00:00Z" }), failed], key).lastError).toBeNull();
    expect(pickDeepDiveState([{ ...failed, error_code: "fuera_de_entrevista" }], key).lastError).toBeNull();
    expect(pickDeepDiveState([{ ...failed, error_code: "sin_preguntas" }], key).lastError).toBeNull();
  });

  it("descarta en silencio las preguntas mal formadas", () => {
    const state = pickDeepDiveState([job({ questions: [{ requirement_id: "r1" }, "texto", { requirement_id: "r2", kind: "confirmar", question: "¿Ha usado Excel?", listen_for: "" }] })], key);
    expect(state.aiQuestions).toEqual([{ requirementId: "r2", kind: "confirmar", question: "¿Ha usado Excel?", listenFor: null }]);
  });
});
