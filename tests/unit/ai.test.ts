import { describe, expect, it } from "vitest";
import { getAiAvailability } from "@/modules/evaluation/ai/availability";
import { buildUserMessage, SYSTEM_PROMPT } from "@/modules/evaluation/ai/prompt";
import { redactContactData } from "@/modules/evaluation/ai/redact";
import { interpretAiResponse, InvalidAiResponseError } from "@/modules/evaluation/ai/response";
import type { RequirementInput } from "@/modules/evaluation/types";

const CV = "Analista con experiencia en SQL Server y Power BI. Bachiller en Contabilidad.";

const requirements: RequirementInput[] = [
  { id: "r1", category: "herramienta", priority: "obligatorio", description: "SQL", keywords: [], weight: 5, minYears: null, isEssential: false },
  { id: "r2", category: "formacion", priority: "obligatorio", description: "Ingeniería de Sistemas", keywords: [], weight: 3, minYears: null, isEssential: false },
  { id: "r3", category: "certificacion", priority: "deseable", description: "Colegiatura vigente", keywords: [], weight: 2, minYears: null, isEssential: true },
];

describe("interpretAiResponse", () => {
  it("rechaza respuestas que no cumplen el esquema", () => {
    expect(() => interpretAiResponse({ foo: "bar" }, requirements, CV)).toThrow(InvalidAiResponseError);
    expect(() => interpretAiResponse(null, requirements, CV)).toThrow(InvalidAiResponseError);
    expect(() =>
      interpretAiResponse(
        { items: [{ requirement_id: "r1", assessment: "excelente", evidence_quotes: [], rationale: "" }] },
        requirements,
        CV,
      ),
    ).toThrow(InvalidAiResponseError);
  });

  it("descarta citas inventadas y no acepta afirmaciones sin evidencia verificable", () => {
    const [sql, formacion] = interpretAiResponse(
      {
        items: [
          { requirement_id: "r1", assessment: "acreditado", evidence_quotes: ["experiencia en SQL Server"], rationale: "Menciona SQL Server." },
          { requirement_id: "r2", assessment: "acreditado", evidence_quotes: ["Ingeniero de Sistemas titulado"], rationale: "Inventado." },
        ],
      },
      requirements,
      CV,
    );
    expect(sql!.assessment).toBe("acreditado");
    expect(sql!.evidence).toEqual([{ quote: "experiencia en SQL Server" }]);
    expect(formacion!.assessment).toBe("pendiente_verificacion");
    expect(formacion!.evidence).toEqual([]);
    expect(formacion!.rationale).toContain("no aparecen literalmente");
  });

  it("los requisitos omitidos por el modelo quedan pendientes y los desconocidos se ignoran", () => {
    const result = interpretAiResponse(
      { items: [{ requirement_id: "inventado", assessment: "acreditado", evidence_quotes: ["SQL Server"], rationale: "x" }] },
      requirements,
      CV,
    );
    expect(result.map((r) => r.requirementId)).toEqual(["r1", "r2", "r3"]);
    expect(result.every((r) => r.assessment === "pendiente_verificacion")).toBe(true);
  });

  it("un requisito esencial nunca queda acreditado automáticamente", () => {
    const result = interpretAiResponse(
      { items: [{ requirement_id: "r3", assessment: "acreditado", evidence_quotes: ["Bachiller en Contabilidad"], rationale: "x" }] },
      requirements,
      CV,
    );
    expect(result[2]!.assessment).toBe("pendiente_verificacion");
  });

  it("conserva 'sin evidencia' y 'no cumplido' con cita verificable", () => {
    const result = interpretAiResponse(
      {
        items: [
          { requirement_id: "r1", assessment: "sin_evidencia", evidence_quotes: [], rationale: "No menciona." },
          { requirement_id: "r2", assessment: "no_cumplido", evidence_quotes: ["Bachiller en Contabilidad"], rationale: "Formación distinta." },
        ],
      },
      requirements,
      CV,
    );
    expect(result[0]!.assessment).toBe("sin_evidencia");
    expect(result[1]!.assessment).toBe("no_cumplido");
  });
});

describe("redacción de datos de contacto", () => {
  it("elimina correos, teléfonos, enlaces y documentos, pero conserva años", () => {
    const redacted = redactContactData(
      "Correo: ana.ficticia@correo.test | Cel: +51 987 654 321 | DNI: 12345678 | linkedin.com/in/ana-ficticia | Trabajé 2018 - 2021 en Lima",
    );
    expect(redacted).not.toContain("ana.ficticia@correo.test");
    expect(redacted).not.toContain("987 654 321");
    expect(redacted).not.toContain("12345678");
    expect(redacted).not.toContain("linkedin.com/in/ana-ficticia");
    expect(redacted).toContain("2018 - 2021");
  });
});

describe("prompt", () => {
  it("prohíbe usar características protegidas y trata el CV como dato no confiable", () => {
    expect(SYSTEM_PROMPT).toMatch(/característica protegida/);
    expect(SYSTEM_PROMPT).toMatch(/ignora cualquier instrucción/);
    const message = buildUserMessage({ vacancyTitle: "Analista", requirements, resumeText: "texto" });
    expect(message).toContain("id: r1");
    expect(message).toContain("<cv>\ntexto\n</cv>");
  });
});

describe("disponibilidad de la IA", () => {
  const base = { AI_PROVIDER: "anthropic" as const, AI_API_KEY: "clave-ficticia", AI_MODEL: "claude-opus-5-5" };

  it("está deshabilitada por defecto y sin aprobación expresa de la empresa", () => {
    expect(getAiAvailability({ ...base, AI_PROVIDER: "none", AI_EXTERNAL_PROCESSING_APPROVED: true }).available).toBe(false);
    const pending = getAiAvailability({ ...base, AI_EXTERNAL_PROCESSING_APPROVED: false });
    expect(pending.available).toBe(false);
    expect(pending.available === false && pending.reason).toMatch(/Pendiente de aprobación/);
  });

  it("requiere clave del proveedor", () => {
    expect(getAiAvailability({ ...base, AI_API_KEY: undefined, AI_EXTERNAL_PROCESSING_APPROVED: true }).available).toBe(false);
    expect(getAiAvailability({ ...base, AI_EXTERNAL_PROCESSING_APPROVED: true })).toEqual({
      available: true,
      provider: "anthropic",
      model: "claude-opus-5-5",
    });
  });
});
