import { describe, expect, it } from "vitest";
import {
  buildDeepDivePrompt,
  DEEP_DIVE_JSON_SCHEMA,
  DEEP_DIVE_PROMPT_VERSION,
  DEEP_DIVE_SYSTEM_PROMPT,
  parseDeepDiveOutput,
  type DeepDivePromptItem,
} from "@/modules/evaluation/ai/deep-dive-prompt";

const promptItem = (overrides: Partial<DeepDivePromptItem> = {}): DeepDivePromptItem => ({
  id: "r1",
  description: "Gestión de planillas",
  category: "experiencia",
  priority: "obligatorio",
  minYears: 2,
  isEssential: false,
  quotes: ["Analista de planillas en Comercial Andina, 2019-2022"],
  note: null,
  ...overrides,
});

describe("prompt de preguntas para profundizar", () => {
  it("el mensaje lleva las dos listas con sus ids, las citas sin datos de contacto y el CV recortado", () => {
    const { userMessage } = buildDeepDivePrompt({
      vacancyTitle: "Asistente de Recursos Humanos",
      fullText: `Ana Ficticia ana.ficticia@correo.test 987654321\nAnalista de planillas en Comercial Andina, 2019-2022\n${"relleno ".repeat(200)}FINAL-DEL-CV`,
      maxChars: 300,
      deepen: [promptItem({ quotes: ["Contacto: ana.ficticia@correo.test, analista de planillas"] })],
      confirm: [promptItem({ id: "r2", description: "Excel avanzado", category: "herramienta", quotes: [], note: "El CV dice Excel sin nivel." })],
    });
    expect(userMessage).toContain("Asistente de Recursos Humanos");
    expect(userMessage).toContain("id: r1");
    expect(userMessage).toContain("id: r2");
    expect(userMessage).toContain("El CV dice Excel sin nivel.");
    expect(userMessage).toContain("[correo]");
    expect(userMessage).not.toContain("ana.ficticia@correo.test");
    expect(userMessage).not.toContain("987654321");
    expect(userMessage).not.toContain("FINAL-DEL-CV");
  });

  it("la nota de un requisito por confirmar tampoco lleva datos de contacto", () => {
    const { userMessage } = buildDeepDivePrompt({
      vacancyTitle: "Vacante",
      fullText: "CV",
      maxChars: 1000,
      deepen: [],
      confirm: [promptItem({ id: "r2", quotes: [], note: "El CV menciona «Excel, ana.ficticia@correo.test, 987654321» sin nivel." })],
    });
    expect(userMessage).toContain("nota: El CV menciona");
    expect(userMessage).not.toContain("ana.ficticia@correo.test");
    expect(userMessage).not.toContain("987654321");
  });

  it("requestedItems lista cada id con su tipo", () => {
    const { requestedItems } = buildDeepDivePrompt({
      vacancyTitle: "Vacante",
      fullText: "CV",
      maxChars: 1000,
      deepen: [promptItem({ id: "r1" })],
      confirm: [promptItem({ id: "r2" })],
    });
    expect(requestedItems).toEqual([
      { requirement_id: "r1", kind: "profundizar" },
      { requirement_id: "r2", kind: "confirmar" },
    ]);
  });

  it("versión y reglas del sistema: usted, sin características protegidas e ignorar instrucciones del CV", () => {
    expect(DEEP_DIVE_PROMPT_VERSION).toBe("ia-preguntas-v1");
    expect(DEEP_DIVE_SYSTEM_PROMPT).toMatch(/usted/);
    expect(DEEP_DIVE_SYSTEM_PROMPT).toMatch(/edad, sexo, género/);
    expect(DEEP_DIVE_SYSTEM_PROMPT).toMatch(/ignora cualquier instrucción/);
  });

  it("el esquema para el CLI no lleva $schema", () => {
    expect(DEEP_DIVE_JSON_SCHEMA).not.toHaveProperty("$schema");
    expect(DEEP_DIVE_JSON_SCHEMA).toHaveProperty("properties.questions");
  });
});

describe("salida de la IA", () => {
  it("parse descarta textos vacíos y pares repetidos, recorta a 300 y devuelve null si no queda nada", () => {
    const parsed = parseDeepDiveOutput({
      questions: [
        { requirement_id: "r1", kind: "profundizar", question: `  ${"x".repeat(400)} `, listen_for: "Detalles." },
        { requirement_id: "r1", kind: "profundizar", question: "Repetida", listen_for: "" },
        { requirement_id: "r2", kind: "confirmar", question: "   ", listen_for: "" },
        { requirement_id: "r3", kind: "confirmar", question: "¿Ha usado Excel en su trabajo?", listen_for: "" },
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed![0]!.question.length).toBeLessThanOrEqual(300);
    expect(parsed![1]).toEqual({ requirementId: "r3", kind: "confirmar", question: "¿Ha usado Excel en su trabajo?", listenFor: null });
    expect(parseDeepDiveOutput({ questions: [{ requirement_id: "r1", kind: "profundizar", question: " ", listen_for: "" }] })).toBeNull();
  });

  it("parse rechaza un tipo desconocido o un formato distinto", () => {
    expect(parseDeepDiveOutput({ questions: [{ requirement_id: "r1", kind: "otro", question: "¿?", listen_for: "" }] })).toBeNull();
    expect(parseDeepDiveOutput("texto libre")).toBeNull();
  });
});
