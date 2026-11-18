import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildEngineNotes, engineNotesForText, hasEngineDoubt, SIGNAL_QUESTIONS } from "@/modules/evaluation/ai/engine-notes";
import { doubtReasons, inControlSample, isDoubtful } from "@/modules/evaluation/ai/doubtful";
import { buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from "@/modules/evaluation/ai/prompt";
import type { CompatibilityLevel, ItemAssessment, RequirementInput } from "@/modules/evaluation/types";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => mocks.env }));

const { autoEnqueueAfterRules } = await import("@/modules/evaluation/ai-queue");

const OBRA: RequirementInput = {
  id: "r-obra",
  category: "experiencia",
  priority: "obligatorio",
  description: "Mínimo 5 años de experiencia en ejecución o supervisión de obras",
  keywords: ["residente de obra", "supervisor de obra", "ingeniero de campo"],
  weight: 5,
  minYears: 5,
  isEssential: false,
};
const INGLES: RequirementInput = {
  id: "r-ingles",
  category: "idioma",
  priority: "deseable",
  description: "Inglés intermedio",
  keywords: [],
  weight: 2,
  minYears: null,
  isEssential: false,
};

const item = (over: Partial<ItemAssessment>): ItemAssessment => ({
  requirementId: "r1",
  assessment: "acreditado",
  evidence: [],
  rationale: "Motivo del motor.",
  ...over,
});

describe("notas del motor para la IA", () => {
  it("solo lleva nota lo que el motor dudó; lo acreditado sin duda y lo verificado por RRHH no", () => {
    expect(hasEngineDoubt(item({ assessment: "acreditado" }))).toBe(false);
    expect(hasEngineDoubt(item({ assessment: "acreditado", signal: "posible_errata" }))).toBe(true);
    expect(hasEngineDoubt(item({ assessment: "pendiente_verificacion" }))).toBe(true);
    expect(hasEngineDoubt(item({ assessment: "sin_evidencia" }))).toBe(true);
    expect(
      hasEngineDoubt(item({ assessment: "acreditado", signal: "cargo_relacionado", cvAssessment: "pendiente_verificacion" })),
    ).toBe(false);
  });

  it("la nota trae la pregunta de su tipo de duda, lo que vio el motor y sus citas", () => {
    const notes = buildEngineNotes([
      item({
        requirementId: "a",
        assessment: "pendiente_verificacion",
        signal: "cargo_relacionado",
        rationale: "El CV menciona un cargo relacionado: «asistente de residencia».",
        evidence: [{ quote: "Asistente de Residencia Feb 2023 - Actualidad" }],
      }),
      item({ requirementId: "b", assessment: "acreditado" }),
      item({ requirementId: "c", assessment: "sin_evidencia", rationale: "No aparece ninguno de los términos." }),
    ]);
    expect(Object.keys(notes.perRequirement).sort()).toEqual(["a", "c"]);
    expect(notes.perRequirement.a).toContain(SIGNAL_QUESTIONS.cargo_relacionado);
    expect(notes.perRequirement.a).toContain("Lo que vio el motor: El CV menciona un cargo relacionado");
    expect(notes.perRequirement.a).toContain("«Asistente de Residencia Feb 2023 - Actualidad»");
    // Sin evidencia: se pide buscar paráfrasis, sin repetir el «no encontré nada» del motor.
    expect(notes.perRequirement.c).toMatch(/otras palabras/);
    expect(notes.perRequirement.c).not.toContain("Lo que vio el motor");
    expect(notes.general).toEqual([]);
  });

  it("las notas pasan por la redacción de datos de contacto, como el CV", () => {
    const notes = buildEngineNotes([
      item({
        requirementId: "a",
        assessment: "pendiente_verificacion",
        signal: "mencion_dudosa",
        evidence: [{ quote: "Excel avanzado, escríbeme a ana.ficticia@correo.test o al 987 654 321" }],
      }),
    ]);
    expect(notes.perRequirement.a).not.toContain("ana.ficticia@correo.test");
    expect(notes.perRequirement.a).not.toContain("987 654 321");
  });

  it("el aviso de relleno llega a la IA sin los consejos de entrevista para RRHH", () => {
    const warning =
      "Posible relleno de palabras clave: el CV repite «excel» 14 veces, más de lo habitual. Puede haberse escrito para coincidir con los filtros: compruebe en la entrevista que los términos estén respaldados. No cambia la evaluación.";
    const notes = buildEngineNotes([], { stuffingWarning: warning });
    expect(notes.general).toHaveLength(1);
    expect(notes.general[0]).toContain("repite «excel» 14 veces");
    expect(notes.general[0]).toContain("pendiente_verificacion");
    expect(notes.general[0]).not.toContain("compruebe en la entrevista");
  });

  it("con un CV real, el cargo parecido llega como duda del motor y el idioma ausente pide buscar paráfrasis", () => {
    const cv = "EXPERIENCIA LABORAL\nAsistente de Residencia Feb 2023 - Actualidad\nControl de avance de obra.";
    const notes = engineNotesForText(cv, [OBRA, INGLES], new Date("2026-11-18T00:00:00Z"));
    expect(notes.perRequirement[OBRA.id]).toContain(SIGNAL_QUESTIONS.cargo_relacionado);
    expect(notes.perRequirement[INGLES.id]).toMatch(/otras palabras/);
  });
});

describe("prompt (desde v3)", () => {
  it("explica cómo usar las notas del motor", () => {
    expect(PROMPT_VERSION).toMatch(/^ia-prompt-v[3-9]$/);
    expect(SYSTEM_PROMPT).toMatch(/nota del motor/);
    expect(SYSTEM_PROMPT).toMatch(/puede estar equivocada/);
  });

  it("alinea las valoraciones con la metodología: no_cumplido solo si el CV lo dice expresamente", () => {
    expect(SYSTEM_PROMPT).toMatch(/"no_cumplido": SOLO cuando el CV dice expresamente/);
    expect(SYSTEM_PROMPT).toMatch(/POR DEBAJO de lo pedido/);
    // La formación de otra área ya no es «no cumplido» (así lo pedía v1): es sin evidencia.
    expect(SYSTEM_PROMPT).toMatch(/"sin_evidencia": el CV no muestra lo pedido[^\n]*formación distinta/);
  });

  it("pone cada nota bajo su requisito y los avisos generales antes del CV", () => {
    const message = buildUserMessage({
      vacancyTitle: "Residente de obra",
      requirements: [OBRA, INGLES],
      resumeText: "texto",
      engineNotes: { perRequirement: { [OBRA.id]: "NOTA-OBRA" }, general: ["AVISO-RELLENO"] },
    });
    const obra = message.slice(message.indexOf(`id: ${OBRA.id}`), message.indexOf(`id: ${INGLES.id}`));
    const ingles = message.slice(message.indexOf(`id: ${INGLES.id}`), message.indexOf("<cv>"));
    expect(obra).toContain("nota del motor: NOTA-OBRA");
    expect(ingles).not.toContain("nota del motor");
    expect(message.indexOf("Avisos sobre el CV:\n- AVISO-RELLENO")).toBeLessThan(message.indexOf("<cv>"));
  });

  it("sin notas, el mensaje no menciona al motor", () => {
    const message = buildUserMessage({ vacancyTitle: "X", requirements: [OBRA], resumeText: "texto" });
    expect(message).not.toContain("nota del motor");
    expect(message).not.toContain("Avisos sobre el CV");
  });
});

const scores = (score: number, potential = score) => ({ score, potential, coverage: 100, unknown: 0, notMet: 100 - potential });
const claro = { level: "alta" as CompatibilityLevel, scores: scores(90), items: [] };

describe("¿cuándo pide el motor la segunda opinión?", () => {
  it("una evaluación clara con una duda concreta del motor (no verificada) es dudosa", () => {
    expect(isDoubtful(claro, [])).toBe(false);
    expect(doubtReasons(claro, [], { engineItems: [{ signal: "cargo_relacionado" }] })).toEqual(["duda_del_motor"]);
    expect(isDoubtful(claro, [], { engineItems: [{ signal: "cargo_relacionado", cvAssessment: "acreditado" }] })).toBe(false);
    expect(isDoubtful(claro, [], { engineItems: [{}] })).toBe(false);
  });

  it("el relleno de palabras clave también pide segunda opinión", () => {
    expect(doubtReasons(claro, [], { suspiciousText: true })).toEqual(["posible_relleno"]);
  });

  it("la muestra de control es determinista y respeta el porcentaje", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const elegidos = ids.filter((id) => inControlSample(id, 10)).length;
    expect(elegidos).toBeGreaterThan(140);
    expect(elegidos).toBeLessThan(260);
    expect(ids.every((id) => inControlSample(id, 10) === inControlSample(id, 10))).toBe(true);
    expect(ids.some((id) => inControlSample(id, 0))).toBe(false);
    expect(ids.every((id) => inControlSample(id, 100))).toBe(true);
  });
});

describe("encolado automático tras el motor", () => {
  const rpc = vi.fn();
  const supabase = { rpc } as unknown as Parameters<typeof autoEnqueueAfterRules>[0];

  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: "job-1", error: null });
    mocks.env = {
      AI_PROVIDER: "claude-cli",
      AI_MODEL: "claude-opus-5-5",
      AI_EXTERNAL_PROCESSING_APPROVED: true,
      AI_WORKER_SECRET: "s".repeat(40),
      AI_AUTO_ENQUEUE: "dudosos",
      AI_CONTROL_SAMPLE_PERCENT: 0,
    };
  });

  it("encola por una duda del motor aunque el puntaje sea claro", async () => {
    await autoEnqueueAfterRules(supabase, { applicationId: "app-1", result: claro, requirements: [], engineItems: [{ signal: "nivel_no_declarado" }] });
    expect(rpc).toHaveBeenCalledWith("request_ai_evaluation", { p_application_id: "app-1", p_automatic: true });
  });

  it("no encola lo claro y sin dudas, salvo que caiga en la muestra de control", async () => {
    await autoEnqueueAfterRules(supabase, { applicationId: "app-1", result: claro, requirements: [], engineItems: [{}] });
    expect(rpc).not.toHaveBeenCalled();

    mocks.env.AI_CONTROL_SAMPLE_PERCENT = 100;
    await autoEnqueueAfterRules(supabase, { applicationId: "app-1", result: claro, requirements: [], engineItems: [{}], system: true });
    expect(rpc).toHaveBeenCalledWith("enqueue_system_ai_evaluation", { p_application_id: "app-1" });
  });
});
