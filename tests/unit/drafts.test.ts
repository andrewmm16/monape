import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { changeStatusSchema } from "@/modules/applications/schemas";
import {
  buildObservationDraft,
  buildReasonDraft,
  buildStatusNoteDraft,
  decisionWarning,
  REASON_MAX_LENGTH,
  suggestStatus,
  type DraftEvaluation,
  type DraftInput,
  type DraftItem,
} from "@/modules/evaluation/drafts";
import { Constants } from "@/types/database";

const CREATED_AT = "2026-10-22T21:54:00Z";

function evaluation(overrides: Partial<DraftEvaluation> = {}): DraftEvaluation {
  return { created_at: CREATED_AT, method: "reglas", criteria_version: 1, score: 0, level: "pendiente", resume: { version: 2 }, ...overrides };
}

const item = (description: string, assessment: DraftItem["assessment"], priority: DraftItem["priority"] = "obligatorio", isEssential = false): DraftItem => ({
  description,
  assessment,
  priority,
  is_essential: isEssential,
});

const input = (evaluationOverrides: Partial<DraftEvaluation>, items: DraftItem[], currentCriteriaVersion = 1): DraftInput => ({
  evaluation: evaluation(evaluationOverrides),
  items,
  currentCriteriaVersion,
});

// Caso real de prueba: CV sin relación con «Practicante de desarrollo web».
const UNRELATED = [
  item("Metodologias agiles", "sin_evidencia", "deseable"),
  item("Desarrollo backend con C# y .NET", "sin_evidencia"),
  item("Desarrollo frontend con React", "sin_evidencia"),
];

const STRONG = [
  item("SQL Server", "acreditado"),
  item("Reportes en Power BI", "acreditado"),
  item("Inglés intermedio", "sin_evidencia"),
  item("Scrum", "acreditado", "deseable"),
];

describe("buildObservationDraft", () => {
  it("resume la evaluación con fecha, método, versiones, nivel y puntuación", () => {
    const draft = buildObservationDraft(input({}, UNRELATED));
    expect(draft.split("\n")[0]).toBe(
      `Resumen de la evaluación del ${formatDate(CREATED_AT)} (Motor de reglas (determinista), criterios v1, CV v2): Evaluación pendiente, 0 % del peso acreditado. Es orientativa.`,
    );
  });

  it("presenta cada grupo como lista y aclara que no aparecer en el CV no es incumplir", () => {
    const draft = buildObservationDraft(input({}, UNRELATED));
    expect(draft).toContain(
      "No aparece en el CV, obligatorios (no significa que no lo cumpla):\n- Desarrollo backend con C# y .NET\n- Desarrollo frontend con React",
    );
    expect(draft).toContain("No aparece en el CV, deseables:\n- Metodologias agiles");
    expect(draft).not.toMatch(/no cumple|incumple|no sabe|no apto/i);
  });

  it("incluye acreditados, pendientes y requisitos esenciales, y omite grupos vacíos", () => {
    const draft = buildObservationDraft(
      input({ score: 60, level: "parcial" }, [item("React", "acreditado"), item("Colegiatura", "pendiente_verificacion", "obligatorio", true)]),
    );
    expect(draft).toContain("Acredita, con evidencia en el CV:\n- React");
    expect(draft).toContain("Para verificar en entrevista o con documentos:\n- Colegiatura (legal o esencial)");
    expect(draft).not.toContain("No aparece en el CV");
  });

  it("presenta lo «aparentemente no cumplido» como algo por confirmar", () => {
    const draft = buildObservationDraft(input({ method: "ia" }, [item("SQL", "no_cumplido")]));
    expect(draft).toContain("Aparentemente no cumple (por confirmar):\n- SQL");
  });

  it("advierte cuando la evaluación usó criterios anteriores a los vigentes", () => {
    expect(buildObservationDraft(input({}, UNRELATED, 2))).toContain("usó los criterios v1; los vigentes son v2");
  });
});

describe("suggestStatus", () => {
  it("sugiere el siguiente paso según la compatibilidad", () => {
    expect(suggestStatus(input({ score: 85, level: "alta" }, STRONG), "nuevo")?.status).toBe("preseleccionado");
    expect(suggestStatus(input({ score: 50, level: "parcial" }, STRONG), "nuevo")?.status).toBe("en_revision");
    expect(suggestStatus(input({ score: 0, level: "pendiente" }, UNRELATED), "nuevo")?.status).toBe("en_revision");
    expect(suggestStatus(input({ method: "ia", score: 10, level: "baja" }, [item("SQL", "no_cumplido")]), "en_revision")?.status).toBe(
      "no_seleccionado",
    );
  });

  it("explica en qué se basa la sugerencia", () => {
    expect(suggestStatus(input({ score: 85, level: "alta" }, STRONG), "nuevo")?.basis).toBe(
      `Compatibilidad alta (85 % acreditado) en la evaluación del ${formatDate(CREATED_AT)}`,
    );
  });

  it("no sugiere nada en etapas avanzadas, si ya está en ese estado, con criterios anteriores o si se pidió reevaluar", () => {
    expect(suggestStatus(input({ score: 85, level: "alta" }, STRONG), "entrevista_programada")).toBeNull();
    expect(suggestStatus(input({ score: 50, level: "parcial" }, STRONG), "en_revision")).toBeNull();
    expect(suggestStatus(input({ score: 85, level: "alta" }, STRONG, 2), "nuevo")).toBeNull();
    expect(suggestStatus(input({ score: 85, level: "alta", review_outcome: "requiere_reevaluacion" }, STRONG), "nuevo")).toBeNull();
  });
});

describe("buildReasonDraft", () => {
  it("redacta el motivo de una preselección en lenguaje natural", () => {
    expect(buildReasonDraft(input({ score: 85, level: "alta" }, STRONG), "preseleccionado")).toBe(
      "Se preselecciona porque el CV acredita 2 de 3 requisitos obligatorios (SQL Server y Reportes en Power BI). " +
        `Falta confirmar Inglés intermedio, que el CV no menciona. (Evaluación orientativa del ${formatDate(CREATED_AT)}.)`,
    );
  });

  it("usa «e» ante palabras que empiezan con el sonido /i/", () => {
    const reason = buildReasonDraft(input({ score: 50, level: "parcial" }, [item("SQL", "acreditado"), item("Inglés", "acreditado")]), "preseleccionado");
    expect(reason).toContain("(SQL e Inglés)");
  });

  it("al no seleccionar enumera solo brechas en requisitos obligatorios", () => {
    const reason = buildReasonDraft(input({}, UNRELATED), "no_seleccionado");
    expect(reason).toBe(
      "No se continúa con la candidatura porque el CV no muestra evidencia de los requisitos obligatorios " +
        `Desarrollo backend con C# y .NET y Desarrollo frontend con React. (Evaluación orientativa del ${formatDate(CREATED_AT)}.)`,
    );
    expect(reason).not.toContain("Metodologias agiles");
  });

  it("si no hay brechas obligatorias, deja el motivo del rechazo para RRHH", () => {
    const reason = buildReasonDraft(input({ score: 89, level: "alta" }, [item("React", "acreditado"), item("Inglés", "sin_evidencia", "deseable")]), "no_seleccionado");
    expect(reason).toContain("no muestra brechas en requisitos obligatorios; indique en qué se basa la decisión:");
  });

  it("genera un motivo para cada estado y el formulario lo acepta", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      item(`Requisito obligatorio con una descripción bastante larga número ${i + 1}`, (["no_cumplido", "sin_evidencia", "acreditado", "pendiente_verificacion"] as const)[i % 4]),
    );
    for (const status of Constants.public.Enums.application_status) {
      const reason = buildReasonDraft(input({ method: "ia", score: 30, level: "baja" }, many, 3), status);
      expect(reason.length, status).toBeLessThanOrEqual(REASON_MAX_LENGTH);
      const note = buildStatusNoteDraft(input({ method: "ia", score: 30, level: "baja" }, many, 3), status);
      const parsed = changeStatusSchema.safeParse({ applicationId: "00000000-0000-4000-8000-000000000001", status, reason, note });
      expect(parsed.success, status).toBe(true);
    }
  });

  it("resume el exceso de requisitos como «y N más» sin pasar el máximo", () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`Requisito obligatorio con una descripción bastante larga número ${i + 1}`, i % 2 ? "sin_evidencia" : "no_cumplido"));
    const reason = buildReasonDraft(input({ method: "ia" }, many, 3), "no_seleccionado");
    expect(reason.length).toBeLessThanOrEqual(REASON_MAX_LENGTH);
    expect(reason).toMatch(/y \d+ más/);
    expect(reason).toContain("aparentemente no cumple");
    expect(reason).toContain("los vigentes son v3");
  });

  it("el retiro no se justifica con la evaluación", () => {
    expect(buildReasonDraft(input({ score: 85, level: "alta" }, STRONG), "retirado")).toBe("La persona se retira del proceso. Motivo indicado:");
  });
});

describe("buildStatusNoteDraft", () => {
  it("agrega el siguiente paso que corresponde al estado", () => {
    const note = buildStatusNoteDraft(input({ score: 85, level: "alta" }, STRONG), "preseleccionado");
    expect(note.startsWith("Resumen de la evaluación")).toBe(true);
    expect(note.endsWith("Siguiente paso: programar la entrevista y confirmar Inglés intermedio.")).toBe(true);
  });
});

describe("decisionWarning", () => {
  it("avisa al no seleccionar sin brechas obligatorias", () => {
    expect(decisionWarning(input({ score: 89, level: "alta" }, [item("React", "acreditado")]), "no_seleccionado")).toMatch(
      /no muestra brechas en requisitos obligatorios/,
    );
  });

  it("avisa al avanzar con requisitos obligatorios aparentemente no cumplidos", () => {
    expect(decisionWarning(input({ method: "ia", level: "baja" }, [item("SQL", "no_cumplido")]), "preseleccionado")).toMatch(
      /aparentemente no cumple requisitos obligatorios \(SQL\)/,
    );
  });

  it("no avisa cuando la decisión concuerda con la evaluación", () => {
    expect(decisionWarning(input({ score: 85, level: "alta" }, STRONG), "preseleccionado")).toBeNull();
    expect(decisionWarning(input({}, UNRELATED), "no_seleccionado")).toBeNull();
  });
});
