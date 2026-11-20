import { describe, expect, it } from "vitest";
import { AI_OUTPUT_JSON_SCHEMA } from "@/modules/evaluation/ai/input";
import { interpretAiResponse } from "@/modules/evaluation/ai/response";
import { buildInterviewGuide, requirementTopic, type GuideItemInput } from "@/modules/evaluation/interview-guide";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import type { RequirementInput } from "@/modules/evaluation/types";

const item = (overrides: Partial<GuideItemInput> = {}): GuideItemInput => ({
  requirementId: "r1",
  description: "Gestión de planillas",
  category: "habilidad_tecnica",
  priority: "obligatorio",
  weight: 5,
  isEssential: false,
  minYears: null,
  position: 0,
  assessment: "sin_evidencia",
  rationale: "El CV no menciona ninguno de los términos configurados (planillas).",
  evidence: [],
  verified: false,
  ...overrides,
});

describe("guía de entrevista: qué entra y en qué orden", () => {
  it("solo lo que falta confirmar: nada acreditado ni verificado por RRHH", () => {
    const guide = buildInterviewGuide([
      item({ requirementId: "ok", assessment: "acreditado" }),
      item({ requirementId: "verificado", assessment: "pendiente_verificacion", verified: true }),
      item({ requirementId: "abierto" }),
    ]);
    expect(guide.map((q) => q.requirementId)).toEqual(["abierto"]);
  });

  it("obligatorios primero; dentro, lo parcial antes que lo que no aparece; luego el peso", () => {
    const guide = buildInterviewGuide([
      item({ requirementId: "deseable-parcial", priority: "deseable", assessment: "pendiente_verificacion", weight: 9, position: 0 }),
      item({ requirementId: "oblig-sin-evidencia-peso3", weight: 3, position: 1 }),
      item({ requirementId: "oblig-sin-evidencia-peso8", weight: 8, position: 2 }),
      item({ requirementId: "oblig-parcial", assessment: "pendiente_verificacion", weight: 1, position: 3 }),
    ]);
    expect(guide.map((q) => q.requirementId)).toEqual([
      "oblig-parcial",
      "oblig-sin-evidencia-peso8",
      "oblig-sin-evidencia-peso3",
      "deseable-parcial",
    ]);
  });

  it("lo que el motor acreditó pero la IA dejó en duda también entra, marcado como tal", () => {
    const [q] = buildInterviewGuide([
      item({
        assessment: "acreditado",
        category: "experiencia",
        minYears: 1,
        ai: { assessment: "pendiente_verificacion", rationale: "Solo figura el año de inicio (2025)." },
      }),
    ]);
    expect(q).toMatchObject({ kind: "duda_ia", source: "motor" });
    expect(q!.reason).toMatch(/la IA lo dejó en duda: Solo figura el año de inicio/);
    expect(q!.passIf).toMatch(/al menos 1 año\./);
  });
});

describe("guía de entrevista: la pregunta", () => {
  it("la de la IA, si revisó el CV, con su motivo; la regla de «cumple si» es la de la plantilla", () => {
    const [q] = buildInterviewGuide([
      item({
        assessment: "pendiente_verificacion",
        ai: {
          assessment: "pendiente_verificacion",
          rationale: "Fue asistente de RRHH, pero no menciona planillas.",
          question: "Como asistente de RRHH, ¿calculaba remuneraciones, CTS o gratificaciones?",
        },
      }),
    ]);
    expect(q).toMatchObject({
      source: "ia",
      question: "Como asistente de RRHH, ¿calculaba remuneraciones, CTS o gratificaciones?",
      reason: "Fue asistente de RRHH, pero no menciona planillas.",
    });
    expect(q!.passIf).toBeTruthy();
  });

  it("sin IA, una plantilla según la duda del motor, con el término del CV", () => {
    const [cargo] = buildInterviewGuide([
      item({
        category: "experiencia",
        minYears: 2,
        assessment: "pendiente_verificacion",
        signal: "cargo_relacionado",
        evidence: [{ quote: "Asistente de Personal — 2021 a 2024", matched: ["Asistente de Personal"] }],
      }),
    ]);
    expect(cargo!.question).toBe("En su puesto de «Asistente de Personal», ¿qué tareas de «Gestión de planillas» hacía usted y durante cuánto tiempo?");
    expect(cargo!.passIf).toMatch(/durante al menos 2 años/);
    expect(cargo!.source).toBe("motor");

    const [fechas] = buildInterviewGuide([item({ assessment: "pendiente_verificacion", signal: "fechas_no_cuadran", minYears: 3 })]);
    expect(fechas!.passIf).toBe("Las fechas suman al menos 3 años en «Gestión de planillas».");
  });

  it("«no cumple» pide confirmar la negación; un requisito legal pide el documento", () => {
    const [negado] = buildInterviewGuide([item({ assessment: "no_cumplido" })]);
    expect(negado!.question).toMatch(/Su CV indica que no tiene «Gestión de planillas»/);
    const [legal] = buildInterviewGuide([item({ isEssential: true, category: "certificacion", assessment: "pendiente_verificacion" })]);
    expect(legal!.question).toMatch(/documento/);
  });

  it("las preguntas nombran el tema del requisito, sin «Mínimo N años de experiencia en» ni «Manejo de»", () => {
    expect(requirementTopic("Mínimo 2 años de experiencia en RRHH")).toBe("RRHH");
    expect(requirementTopic("Mínimo 3 años de experiencia en contabilidad general")).toBe("contabilidad general");
    expect(requirementTopic("Experiencia con SAP Business One o Concar")).toBe("SAP Business One o Concar");
    expect(requirementTopic("Manejo de PLE y PLAME")).toBe("PLE y PLAME");
    expect(requirementTopic("Conocimiento de tributación peruana (IGV, renta mensual, PDT 621)")).toBe("tributación peruana (IGV, renta mensual, PDT 621)");
    expect(requirementTopic("Excel intermedio-avanzado")).toBe("Excel intermedio-avanzado");
    expect(requirementTopic("Experiencia")).toBe("Experiencia");

    const [plame] = buildInterviewGuide([item({ description: "Manejo de PLAME", category: "herramienta" })]);
    expect(plame!.question).toBe("¿Ha usado «PLAME»? ¿Para qué y con qué frecuencia? Pida un ejemplo.");
    const [rrhh] = buildInterviewGuide([item({ description: "Mínimo 2 años de experiencia en RRHH", minYears: 2 })]);
    expect(rrhh!.question).toBe("¿Ha trabajado en «RRHH»? ¿Dónde, haciendo qué y durante cuánto tiempo?");
    expect(rrhh!.passIf).toBe("Describe experiencia propia en «RRHH» durante al menos 2 años.");
  });

  it("ninguna plantilla es vaga: siempre nombra el requisito o lo que dice el CV", () => {
    const VAGUE = /\b(esto|eso)\b|lo pedido|algo parecido|algo relacionado|de este tipo|esta experiencia|lo que pide el puesto/i;
    const signals = [
      "negacion_explicita",
      "nivel_inferior",
      "nivel_no_declarado",
      "cargo_relacionado",
      "habilidad_relacionada",
      "mencion_dudosa",
      "fechas_no_cuadran",
      "solo_capacitacion",
      "posible_errata",
    ] as const;
    const categories = ["formacion", "experiencia", "habilidad_tecnica", "herramienta", "certificacion", "competencia", "idioma", "otro"] as const;
    const cases: GuideItemInput[] = [
      ...signals.flatMap((signal) => [
        item({ assessment: "pendiente_verificacion", signal, evidence: [{ quote: "Asistente de Personal", matched: ["Asistente de Personal"] }] }),
        item({ assessment: "pendiente_verificacion", signal }),
      ]),
      ...categories.flatMap((category) => [
        item({ category }),
        item({ category, assessment: "pendiente_verificacion" }),
        item({ category, minYears: 2 }),
      ]),
      item({ isEssential: true, category: "certificacion" }),
      item({ assessment: "no_cumplido" }),
    ];
    for (const input of cases) {
      const [q] = buildInterviewGuide([input]);
      const label = `${input.signal ?? input.category}/${input.assessment}`;
      expect(q!.question, label).not.toMatch(VAGUE);
      expect(q!.passIf, label).not.toMatch(VAGUE);
      expect(q!.question, label).toMatch(/«Gestión de planillas»|«Asistente de Personal»/);
    }
  });

  it("lo que no aparece en el CV se explica en corto; los motivos largos se recortan", () => {
    const [vacio] = buildInterviewGuide([item()]);
    expect(vacio!.reason).toBe("Su CV no menciona «Gestión de planillas».");
    const [largo] = buildInterviewGuide([item({ assessment: "pendiente_verificacion", rationale: "palabra ".repeat(100) })]);
    expect(largo!.reason.length).toBeLessThanOrEqual(240);
    expect(largo!.reason.endsWith("…")).toBe(true);
  });
});

describe("guía de entrevista con el motor real", () => {
  const req = (id: string, description: string, keywords: string[], extra: Partial<RequirementInput> = {}): RequirementInput => ({
    id,
    category: "habilidad_tecnica",
    priority: "obligatorio",
    description,
    keywords,
    weight: 5,
    minYears: null,
    isEssential: false,
    ...extra,
  });

  it("Excel básico frente a Excel avanzado: pregunta por lo más avanzado que hizo con Excel", () => {
    const requirements = [
      req("excel", "Excel avanzado", ["excel", "tablas dinámicas"], { category: "herramienta" }),
      req("planillas", "Gestión de planillas", ["planillas", "nómina"]),
    ];
    const cv = "EXPERIENCIA\nAsistente administrativa — Comercial Andina (2022 - 2025)\nHABILIDADES\nExcel básico, Word.";
    const items = evaluateWithRules(cv, requirements, { referenceDate: new Date("2026-11-18T12:00:00Z") });
    const guide = buildInterviewGuide(
      items.map((i, position) => {
        const r = requirements.find((x) => x.id === i.requirementId)!;
        return { ...i, ...r, requirementId: r.id, position, verified: false };
      }),
    );
    const excel = guide.find((q) => q.requirementId === "excel")!;
    expect(excel.question).toMatch(/nivel menor .* con «Excel»\?/);
    expect(guide.find((q) => q.requirementId === "planillas")!.reason).toBe("Su CV no menciona «Gestión de planillas».");
  });
});

describe("pregunta de entrevista de la IA (ia-prompt-v5)", () => {
  const requirements: RequirementInput[] = [
    { id: "r1", category: "habilidad_tecnica", priority: "obligatorio", description: "Gestión de planillas", keywords: ["planillas"], weight: 5, minYears: null, isEssential: false },
    { id: "r2", category: "herramienta", priority: "obligatorio", description: "Excel avanzado", keywords: ["excel"], weight: 5, minYears: null, isEssential: false },
    { id: "r3", category: "herramienta", priority: "deseable", description: "Git", keywords: ["git"], weight: 5, minYears: null, isEssential: false },
  ];
  const item = (id: string, interview_question: string | null | undefined) => ({
    requirement_id: id,
    assessment: "pendiente_verificacion",
    evidence_quotes: [],
    rationale: "Motivo.",
    ...(interview_question === undefined ? {} : { interview_question }),
  });

  it("se guarda limpia; vacía, mínima o ausente no cuenta; muy larga se recorta", () => {
    const items = interpretAiResponse(
      { items: [item("r1", "  ¿Calculaba   remuneraciones o CTS?  "), item("r2", "   "), item("r3", undefined)] },
      requirements,
      "Asistente de RRHH",
    );
    expect(items.map((i) => i.interviewQuestion)).toEqual(["¿Calculaba remuneraciones o CTS?", undefined, undefined]);
    const [long] = interpretAiResponse({ items: [item("r1", "¿".padEnd(500, "a"))] }, requirements.slice(0, 1), "x");
    expect(long!.interviewQuestion!.length).toBe(300);
  });

  it("el esquema que recibe el worker la admite (opcional, para no romper respuestas viejas)", () => {
    const itemSchema = (AI_OUTPUT_JSON_SCHEMA as { properties: { items: { items: { properties: Record<string, unknown>; required?: string[] } } } })
      .properties.items.items;
    expect(itemSchema.properties).toHaveProperty("interview_question");
    expect(itemSchema.required ?? []).not.toContain("interview_question");
  });
});
