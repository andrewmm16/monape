import { describe, expect, it } from "vitest";
import { assembleEvaluation } from "@/modules/evaluation/assemble";
import type { ItemAssessment, RequirementInput } from "@/modules/evaluation/types";
import {
  applyVerifications,
  buildVerifiedRationale,
  rebuildItems,
  restoreCvItems,
  type RequirementVerification,
  type StoredEvaluationItem,
} from "@/modules/evaluation/verifications";

const req = (id: string, weight: number, priority: RequirementInput["priority"] = "obligatorio"): RequirementInput => ({
  id,
  category: "idioma",
  priority,
  description: `Requisito ${id}`,
  keywords: [],
  weight,
  minYears: null,
  isEssential: false,
});

const cvItem = (requirementId: string, assessment: ItemAssessment["assessment"], rationale = "No se encontró mención."): ItemAssessment => ({
  requirementId,
  assessment,
  evidence: assessment === "acreditado" ? [{ quote: "Inglés avanzado", start: 0, end: 15 }] : [],
  rationale,
});

const verification = (overrides: Partial<RequirementVerification> = {}): RequirementVerification => ({
  requirementId: "a",
  result: "acreditado",
  source: "entrevista",
  note: "Conversación fluida de 10 minutos",
  verifiedAt: "2026-10-28T15:00:00Z",
  verifiedByName: "Luis",
  ...overrides,
});

describe("buildVerifiedRationale", () => {
  it("redacta fuente, fecha dd/mm/aaaa, persona, nota y motivo original", () => {
    expect(buildVerifiedRationale(verification(), "Sin mención del requisito.")).toBe(
      "Verificado en entrevista el 28/10/2026 por Luis: Conversación fluida de 10 minutos. Según el CV: Sin mención del requisito.",
    );
  });

  it("usa la fecha de Lima y omite la persona si ya no existe", () => {
    const text = buildVerifiedRationale(verification({ verifiedAt: "2026-10-29T02:00:00Z", verifiedByName: null, source: "prueba_tecnica" }), "x");
    expect(text).toMatch(/^Verificado en prueba técnica el 28\/10\/2026: /);
  });

  it("se recorta a 2000 caracteres", () => {
    const text = buildVerifiedRationale(verification({ note: "n".repeat(1000) }), "m".repeat(3000));
    expect(text).toHaveLength(2000);
  });
});

describe("applyVerifications", () => {
  it("reemplaza la valoración, conserva la original y la evidencia del CV", () => {
    const items = [cvItem("a", "sin_evidencia"), cvItem("b", "acreditado")];
    const [a, b] = applyVerifications(items, [verification()]);
    expect(a).toMatchObject({ requirementId: "a", assessment: "acreditado", cvAssessment: "sin_evidencia", evidence: [] });
    expect(a!.rationale).toContain("Según el CV: No se encontró mención.");
    expect(b).toBe(items[1]);
    expect(b!.cvAssessment).toBeUndefined();

    const withEvidence = applyVerifications([cvItem("a", "acreditado")], [verification({ result: "no_cumplido" })]);
    expect(withEvidence[0]).toMatchObject({ assessment: "no_cumplido", cvAssessment: "acreditado" });
    expect(withEvidence[0]!.evidence).toHaveLength(1);
  });

  it("no modifica las entradas", () => {
    const items = [cvItem("a", "sin_evidencia")];
    applyVerifications(items, [verification()]);
    expect(items[0]!.assessment).toBe("sin_evidencia");
    expect(items[0]!.cvAssessment).toBeUndefined();
  });

  it("sube la puntuación al verificar «cumple» y la baja con un obligatorio que no cumple", () => {
    const requirements = [req("a", 5), req("b", 5)];
    const base = [cvItem("a", "sin_evidencia"), cvItem("b", "acreditado")];
    const run = (items: ItemAssessment[]) =>
      assembleEvaluation({ method: "reglas", methodVersion: "v", model: null, requirements, items, textWasCorrected: false, textTruncated: false });

    expect(run(base).scores.score).toBe(50);
    const up = run(applyVerifications(base, [verification()]));
    expect(up.scores.score).toBe(100);
    expect(up.level).toBe("alta");
    expect(up.items[0]!.cvAssessment).toBe("sin_evidencia");
    expect(up.limitations.join(" ")).toContain("1 requisito fue verificado por RRHH");

    const down = run(applyVerifications(base, [verification({ requirementId: "b", result: "no_cumplido" })]));
    expect(down.scores.score).toBe(0);
    expect(down.level).toBe("baja");
  });
});

describe("resumen de la evaluación con verificaciones", () => {
  it("separa «cumple» y «no cumple» verificados de lo que dice el CV", () => {
    const requirements = [req("a", 3), req("b", 3), req("c", 3), req("d", 3)];
    const base = [cvItem("a", "sin_evidencia"), cvItem("b", "acreditado"), cvItem("c", "acreditado"), cvItem("d", "no_cumplido")];
    const items = applyVerifications(base, [verification(), verification({ requirementId: "c", result: "no_cumplido" })]);
    const { summary } = assembleEvaluation({ method: "reglas", methodVersion: "v", model: null, requirements, items, textWasCorrected: false, textTruncated: false });
    expect(summary).toContain("1 acreditado, 1 aparentemente no cumplido, 1 cumple (verificado), 1 no cumple (verificado)");
  });
});

describe("reconstrucción de una evaluación tras cambiar una verificación", () => {
  const requirements = [req("a", 5), req("b", 3), req("c", 2, "deseable")];
  const original = [
    cvItem("a", "sin_evidencia", "Sin mención de inglés."),
    cvItem("b", "pendiente_verificacion", "El modelo no pudo citar el CV."),
    cvItem("c", "acreditado", "Menciona Power BI."),
  ];
  const assemble = (items: ItemAssessment[]) =>
    assembleEvaluation({
      method: "ia",
      methodVersion: "prompt-v1",
      model: "modelo-ficticio",
      requirements,
      items,
      textWasCorrected: false,
      textTruncated: false,
    });
  /** Lo que queda guardado de una evaluación (con la copia de cv_rationale del servidor). */
  const stored = (items: ItemAssessment[]): StoredEvaluationItem[] =>
    items.map((i) => ({
      requirementId: i.requirementId,
      assessment: i.assessment,
      cvAssessment: i.cvAssessment ?? null,
      rationale: i.rationale,
      cvRationale: i.cvRationale ?? null,
      evidence: i.evidence,
    }));

  it("applyVerifications entrega el motivo original para guardarlo", () => {
    const [a, b] = applyVerifications(original, [verification()]);
    expect(a).toMatchObject({ assessment: "acreditado", cvAssessment: "sin_evidencia", cvRationale: "Sin mención de inglés." });
    expect(b!.cvRationale).toBeUndefined();
  });

  it("sin verificaciones restaura exactamente lo que dio el CV y conserva método, modelo y evidencia", () => {
    const verified = assemble(applyVerifications(original, [verification()]));
    expect(verified.method).toBe("ia");
    expect(verified.model).toBe("modelo-ficticio");
    expect(verified.scores.score).toBeGreaterThan(assemble(original).scores.score);

    const restored = rebuildItems(stored(verified.items), []);
    expect(restored).toEqual(original);
    const rebuilt = assemble(restored);
    expect(rebuilt.scores).toEqual(assemble(original).scores);
    expect(rebuilt.level).toBe(assemble(original).level);
    expect(rebuilt.items.every((i) => !i.cvAssessment && !i.cvRationale)).toBe(true);
  });

  it("al agregar una verificación no toca los requisitos no verificados", () => {
    const rebuilt = rebuildItems(stored(original), [verification({ requirementId: "b", result: "no_cumplido" })]);
    expect(rebuilt[0]).toEqual(original[0]);
    expect(rebuilt[2]).toEqual(original[2]);
    expect(rebuilt[1]).toMatchObject({ assessment: "no_cumplido", cvAssessment: "pendiente_verificacion", cvRationale: "El modelo no pudo citar el CV." });
  });

  it("cambiar una verificación parte siempre del CV, no de la verificación anterior", () => {
    const first = assemble(applyVerifications(original, [verification({ result: "acreditado" })]));
    const second = rebuildItems(stored(first.items), [verification({ result: "no_cumplido", note: "Otra nota" })]);
    expect(second[0]).toMatchObject({ assessment: "no_cumplido", cvAssessment: "sin_evidencia", cvRationale: "Sin mención de inglés." });
    expect(second[0]!.rationale).toBe(buildVerifiedRationale(verification({ result: "no_cumplido", note: "Otra nota" }), "Sin mención de inglés."));
  });

  it("evaluaciones verificadas antes de cv_rationale: recupera el motivo del texto", () => {
    const legacy: StoredEvaluationItem[] = [
      {
        requirementId: "a",
        assessment: "acreditado",
        cvAssessment: "sin_evidencia",
        rationale: "Verificado en entrevista el 28/10/2026 por Luis: Muy bien. Según el CV: Sin mención de inglés.",
        cvRationale: null,
        evidence: [],
      },
      { requirementId: "b", assessment: "acreditado", cvAssessment: "acreditado", rationale: "Sin formato conocido", cvRationale: null, evidence: [] },
    ];
    const restored = restoreCvItems(legacy);
    expect(restored[0]).toMatchObject({ assessment: "sin_evidencia", rationale: "Sin mención de inglés." });
    expect(restored[1]).toMatchObject({ assessment: "acreditado", rationale: "" });
  });
});
