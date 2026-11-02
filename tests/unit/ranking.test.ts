import { describe, expect, it } from "vitest";
import { parseCompareIds, rankCandidates, rankingFacts, type RankInput } from "@/modules/applications/ranking";

const candidate = (id: string, overrides: Partial<RankInput> = {}): RankInput => ({
  id,
  score: 50,
  evaluationOutdated: false,
  hasVerifiedMandatoryNotMet: false,
  mandatoryMetWeight: 5,
  verifiedMetCount: 0,
  appliedAt: "2026-10-01T10:00:00Z",
  ...overrides,
});

const order = (list: RankInput[]) => rankCandidates(list).map((c) => c.id);

describe("rankCandidates", () => {
  it("ordena por mayor puntuación", () => {
    expect(order([candidate("a", { score: 40 }), candidate("b", { score: 90 }), candidate("c", { score: 60 })])).toEqual(["b", "c", "a"]);
  });

  it("deja al final a quien tiene un obligatorio con «no cumple» verificado, aunque tenga más puntuación", () => {
    expect(
      order([candidate("a", { score: 95, hasVerifiedMandatoryNotMet: true }), candidate("b", { score: 30 }), candidate("c", { score: 60 })]),
    ).toEqual(["c", "b", "a"]);
  });

  it("deja las evaluaciones desactualizadas después de las vigentes, pero antes de quien no cumple un obligatorio verificado", () => {
    expect(
      order([
        candidate("a", { score: 99, evaluationOutdated: true }),
        candidate("b", { score: 99, hasVerifiedMandatoryNotMet: true }),
        candidate("c", { score: 10 }),
      ]),
    ).toEqual(["c", "a", "b"]);
  });

  it("desempata por mayor peso de obligatorios acreditados", () => {
    expect(order([candidate("a", { mandatoryMetWeight: 3 }), candidate("b", { mandatoryMetWeight: 8 })])).toEqual(["b", "a"]);
  });

  it("desempata por más requisitos verificados como «cumple»", () => {
    expect(order([candidate("a", { verifiedMetCount: 0 }), candidate("b", { verifiedMetCount: 2 })])).toEqual(["b", "a"]);
  });

  it("desempata por la postulación más antigua y, al final, por id", () => {
    expect(order([candidate("a", { appliedAt: "2026-10-05T00:00:00Z" }), candidate("b", { appliedAt: "2026-10-02T00:00:00Z" })])).toEqual(["b", "a"]);
    expect(order([candidate("z"), candidate("m"), candidate("b")])).toEqual(["b", "m", "z"]);
  });

  it("admite el resultado de entrevista como desempate antes de la antigüedad, sin alterar el orden si no se informa", () => {
    const older = candidate("a", { appliedAt: "2026-09-01T00:00:00Z" });
    const newer = candidate("b", { appliedAt: "2026-10-01T00:00:00Z" });
    expect(order([older, newer])).toEqual(["a", "b"]);
    expect(order([older, { ...newer, interviewScore: 4 }])).toEqual(["b", "a"]);
    expect(order([{ ...older, interviewScore: 5 }, { ...newer, interviewScore: 4 }])).toEqual(["a", "b"]);
  });

  it("con interviewScore 1 («Pasó») gana a 0 (sin entrevista o «No pasó») aunque sea más reciente", () => {
    const older = candidate("a", { appliedAt: "2026-09-01T00:00:00Z", interviewScore: 0 });
    const newerPassed = candidate("b", { appliedAt: "2026-10-01T00:00:00Z", interviewScore: 1 });
    expect(order([older, newerPassed])).toEqual(["b", "a"]);
    // La entrevista no pasa por encima de la puntuación ni de los requisitos verificados.
    expect(order([candidate("a", { score: 80, interviewScore: 0 }), candidate("b", { score: 60, interviewScore: 1 })])).toEqual(["a", "b"]);
    expect(order([candidate("a", { verifiedMetCount: 2, interviewScore: 0 }), candidate("b", { verifiedMetCount: 1, interviewScore: 1 })])).toEqual(["a", "b"]);
  });

  it("es determinista y no modifica la entrada", () => {
    const input = [candidate("c", { score: 10 }), candidate("a", { score: 90 }), candidate("b", { score: 90 })];
    const snapshot = input.map((c) => c.id);
    expect(order(input)).toEqual(["a", "b", "c"]);
    expect(order([...input].reverse())).toEqual(["a", "b", "c"]);
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });
});

describe("rankingFacts", () => {
  it("resume los ítems de la evaluación", () => {
    expect(
      rankingFacts([
        { priority: "obligatorio", weight: 5, assessment: "acreditado", verification_source: "entrevista" },
        { priority: "obligatorio", weight: 3, assessment: "acreditado", verification_source: null },
        { priority: "deseable", weight: 2, assessment: "acreditado", verification_source: "documento" },
        { priority: "obligatorio", weight: 4, assessment: "no_cumplido", verification_source: null },
      ]),
    ).toEqual({ hasVerifiedMandatoryNotMet: false, mandatoryMetWeight: 8, verifiedMetCount: 2 });
    expect(
      rankingFacts([
        { priority: "obligatorio", weight: 4, assessment: "no_cumplido", verification_source: "prueba_tecnica" },
        { priority: "deseable", weight: 1, assessment: "no_cumplido", verification_source: "entrevista" },
      ]).hasVerifiedMandatoryNotMet,
    ).toBe(true);
    // Un «no cumple» verificado en un deseable no excluye.
    expect(
      rankingFacts([{ priority: "deseable", weight: 1, assessment: "no_cumplido", verification_source: "entrevista" }]).hasVerifiedMandatoryNotMet,
    ).toBe(false);
  });
});

describe("parseCompareIds", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";
  const D = "44444444-4444-4444-8444-444444444444";
  const E = "55555555-5555-4555-8555-555555555555";

  it("acepta de 2 a 4 identificadores, separados por comas o repetidos, sin duplicados", () => {
    expect(parseCompareIds(`${A},${B}`)).toEqual({ ok: true, ids: [A, B] });
    expect(parseCompareIds([A, `${B},${C}`, D])).toEqual({ ok: true, ids: [A, B, C, D] });
    expect(parseCompareIds(` ${A} , ${A.toUpperCase()}, ${B}`)).toEqual({ ok: true, ids: [A, B] });
  });

  it("explica por qué rechaza la entrada", () => {
    expect(parseCompareIds(undefined)).toMatchObject({ ok: false, error: expect.stringContaining("Elija de 2 a 4") });
    expect(parseCompareIds(A)).toMatchObject({ ok: false, error: expect.stringContaining("al menos 2") });
    expect(parseCompareIds(`${A},${A}`)).toMatchObject({ ok: false, error: expect.stringContaining("al menos 2") });
    expect(parseCompareIds(`${A},${B},${C},${D},${E}`)).toMatchObject({ ok: false, error: expect.stringContaining("hasta 4") });
    expect(parseCompareIds(`${A},no-es-uuid`)).toMatchObject({ ok: false, error: expect.stringContaining("no es válido") });
  });
});
