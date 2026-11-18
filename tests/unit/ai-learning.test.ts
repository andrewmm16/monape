import { describe, expect, it } from "vitest";
import { buildEngineNotes } from "@/modules/evaluation/ai/engine-notes";
import { buildJudgePrompt, JUDGE_JSON_SCHEMA, parseJudgeOutput } from "@/modules/evaluation/ai/judge";
import { buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from "@/modules/evaluation/ai/prompt";
import { hasRelayedItems, relayToAi } from "@/modules/evaluation/ai/relay";
import { extractEquivalenceVotes } from "@/modules/evaluation/ai/response";
import {
  isLearnableVote,
  normalizeLearnedTerm,
  requirementKey,
  votesFromVerifications,
  type LearnedRule,
} from "@/modules/evaluation/learned";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import type { ItemAssessment, RequirementInput } from "@/modules/evaluation/types";

const REF = new Date("2026-11-18T12:00:00Z");

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

const rule = (term: string, verdict: LearnedRule["verdict"], requirement = OBRA): LearnedRule => ({
  id: `regla-${term}`,
  requirementKey: requirementKey(requirement),
  term: normalizeLearnedTerm(term)!.term,
  termDisplay: term,
  verdict,
});

const evalua = (cv: string, learned: LearnedRule[] = [], requirement = OBRA) =>
  evaluateWithRules(cv, [requirement], { referenceDate: REF, learned })[0]!;

describe("reglas aprendidas en el motor", () => {
  const ASISTENTE = "EXPERIENCIA LABORAL\nAsistente de Residencia Feb 2018 - Actualidad\nControl de avance de obra y cuaderno de obra.";
  const MAESTRO = "EXPERIENCIA LABORAL\nMaestro de Obra Ene 2012 - Actualidad\nDirijo cuadrillas en obra.";

  it("sin reglas, un cargo parecido queda por confirmar con la duda del motor", () => {
    expect(evalua(ASISTENTE)).toMatchObject({ assessment: "pendiente_verificacion", signal: "cargo_relacionado" });
  });

  it("«equivale»: el término cuenta como palabra clave y el motor calcula los años por fechas", () => {
    const item = evalua(ASISTENTE, [rule("Asistente de Residencia", "equivale")]);
    expect(item.assessment).toBe("acreditado");
    expect(item.signal).toBeUndefined();
    expect(item).toMatchObject({ resolvedBy: "regla_aprendida", engineAssessment: "pendiente_verificacion", learnedRuleId: "regla-Asistente de Residencia" });
    expect(item.rationale).toMatch(/Regla aprendida: «Asistente de Residencia» cuenta/);
  });

  it("«equivale» no salta el mínimo de años: si las fechas no alcanzan, sigue por confirmar", () => {
    const corto = "EXPERIENCIA LABORAL\nAsistente de Residencia Feb 2025 - Actualidad\nControl de avance de obra.";
    const item = evalua(corto, [rule("Asistente de Residencia", "equivale")]);
    expect(item.assessment).not.toBe("acreditado");
  });

  it("«no equivale»: quita la duda (ya no se consulta a la IA) pero deja el requisito por confirmar", () => {
    const item = evalua(MAESTRO, [rule("Maestro de Obra", "no_equivale")]);
    expect(item.assessment).toBe("pendiente_verificacion");
    expect(item.signal).toBeUndefined();
    expect(item).toMatchObject({ resolvedBy: "regla_aprendida", learnedRuleId: "regla-Maestro de Obra" });
    expect(item.rationale).toMatch(/no equivale/);
  });

  it("nunca en requisitos legales o esenciales, ni con reglas de otro requisito", () => {
    const esencial = { ...OBRA, isEssential: true };
    expect(evalua(ASISTENTE, [rule("Asistente de Residencia", "equivale", esencial)], esencial).resolvedBy).toBeUndefined();
    const otro = { ...OBRA, description: "Experiencia en ventas" };
    expect(evalua(ASISTENTE, [rule("Asistente de Residencia", "equivale", otro)]).resolvedBy).toBeUndefined();
  });

  it("la clave del requisito ignora mayúsculas, tildes y espacios; el término se valida", () => {
    expect(requirementKey({ category: "experiencia", description: "Mínimo  5 AÑOS de Supervisión" })).toBe(
      requirementKey({ category: "experiencia", description: "minimo 5 anos de supervision" }),
    );
    expect(normalizeLearnedTerm(" «Asistente de Residencia». ")).toEqual({ term: "asistente de residencia", display: "Asistente de Residencia" });
    expect(normalizeLearnedTerm("uno dos tres cuatro cinco seis siete")).toBeNull();
    expect(normalizeLearnedTerm("2018 - 2024")).toBeNull();
  });
});

const item = (requirementId: string, assessment: ItemAssessment["assessment"], extra: Partial<ItemAssessment> = {}): ItemAssessment => ({
  requirementId,
  assessment,
  evidence: [],
  rationale: `motor-${requirementId}`,
  ...extra,
});

describe("la IA releva al motor en lo dudoso", () => {
  it("cuenta la IA donde el motor dudó; lo seguro y lo resuelto por una regla aprendida quedan del motor", () => {
    const engine = [
      item("a", "pendiente_verificacion", { signal: "cargo_relacionado" }),
      item("b", "sin_evidencia"),
      item("c", "acreditado"),
      item("d", "pendiente_verificacion", { resolvedBy: "regla_aprendida", learnedRuleId: "x" }),
    ];
    const ai = [
      item("a", "acreditado", { rationale: "Equivale.", evidence: [{ quote: "Asistente de Residencia" }] }),
      item("b", "no_cumplido", { rationale: "Dice «sin experiencia en planillas»." }),
      item("c", "pendiente_verificacion"),
      item("d", "acreditado"),
    ];
    const out = relayToAi(engine, ai);
    expect(out[0]).toMatchObject({ assessment: "acreditado", resolvedBy: "ia", engineAssessment: "pendiente_verificacion" });
    expect(out[0]!.rationale).toBe("Resuelto por la IA (el motor lo dejó por confirmar): Equivale.");
    expect(out[0]!.evidence).toEqual([{ quote: "Asistente de Residencia" }]);
    expect(out[1]).toMatchObject({ assessment: "no_cumplido", resolvedBy: "ia", engineAssessment: "sin_evidencia" });
    expect(out[2]).toEqual(engine[2]);
    expect(out[3]).toEqual(engine[3]);
    expect(hasRelayedItems(out)).toBe(true);
    expect(hasRelayedItems(relayToAi(engine, []))).toBe(false);
  });

  it("usa la valoración original de la IA, no la verificada (RRHH se vuelve a aplicar después)", () => {
    const out = relayToAi(
      [item("a", "pendiente_verificacion")],
      [item("a", "no_cumplido", { cvAssessment: "acreditado", cvRationale: "La IA dijo que sí." })],
    );
    expect(out[0]).toMatchObject({ assessment: "acreditado" });
    expect(out[0]!.rationale).toContain("La IA dijo que sí.");
  });
});

describe("votos de la IA para que el motor aprenda", () => {
  const CV = "EXPERIENCIA\nAsistente de Residencia en Constructora Ficticia, 2019 - 2024.";
  const raw = (equivalence: unknown, id = OBRA.id) => ({
    items: [{ requirement_id: id, assessment: "acreditado", evidence_quotes: ["Asistente de Residencia"], rationale: "Equivale.", equivalence }],
  });

  it("solo vota con un término literal del CV, de 1 a 6 palabras, en requisitos no esenciales", () => {
    expect(extractEquivalenceVotes(raw({ cv_term: "Asistente de Residencia", equivalent: true }), [OBRA], CV)).toEqual([
      { requirementId: OBRA.id, term: "asistente de residencia", display: "Asistente de Residencia", equivalent: true, rationale: "Equivale." },
    ]);
    expect(extractEquivalenceVotes(raw({ cv_term: "Jefe de Obra", equivalent: true }), [OBRA], CV)).toEqual([]);
    expect(extractEquivalenceVotes(raw({ cv_term: "Asistente de Residencia", equivalent: true }), [{ ...OBRA, isEssential: true }], CV)).toEqual([]);
    expect(extractEquivalenceVotes(raw(null), [OBRA], CV)).toEqual([]);
    expect(extractEquivalenceVotes({ items: "roto" }, [OBRA], CV)).toEqual([]);
  });

  it("solo aprende de dudas de vocabulario, no del juicio caso a caso", () => {
    expect(isLearnableVote(item("a", "pendiente_verificacion", { signal: "cargo_relacionado" }))).toBe(true);
    expect(isLearnableVote(item("a", "pendiente_verificacion", { signal: "posible_errata" }))).toBe(true);
    expect(isLearnableVote(item("a", "sin_evidencia"))).toBe(true);
    // Donde no apareció nada, un «no cuenta» no resuelve ninguna duda: no se aprende.
    expect(isLearnableVote(item("a", "sin_evidencia"), false)).toBe(false);
    expect(isLearnableVote(item("a", "pendiente_verificacion", { signal: "cargo_relacionado" }), false)).toBe(true);
    expect(isLearnableVote(item("a", "acreditado", { resolvedBy: "regla_aprendida" }))).toBe(true); // control
    expect(isLearnableVote(item("a", "pendiente_verificacion", { signal: "nivel_inferior" }))).toBe(false);
    expect(isLearnableVote(item("a", "pendiente_verificacion", { signal: "mencion_dudosa" }))).toBe(false);
    expect(isLearnableVote(item("a", "acreditado"))).toBe(false);
    expect(isLearnableVote(item("a", "sin_evidencia", { cvAssessment: "sin_evidencia" }))).toBe(false); // verificado
    expect(isLearnableVote(undefined)).toBe(false);
  });
});

describe("lo que RRHH verifica también enseña al motor", () => {
  const engine = [
    item("a", "pendiente_verificacion", {
      signal: "cargo_relacionado",
      evidence: [{ quote: "Asistente de Residencia 2018 - 2024", matched: ["Asistente de Residencia"] }],
    }),
    item("b", "pendiente_verificacion", { signal: "nivel_inferior", evidence: [{ quote: "Inglés básico", matched: ["Inglés"] }] }),
    item("c", "sin_evidencia"),
  ];

  it("«cumple» donde el motor dudó por un cargo parecido: vota que el término cuenta", () => {
    expect(
      votesFromVerifications(engine, [
        { requirementId: "a", result: "acreditado", source: "Entrevista" },
        { requirementId: "a", result: "acreditado" },
      ]),
    ).toEqual([
      {
        requirementId: "a",
        term: "asistente de residencia",
        display: "Asistente de Residencia",
        equivalent: true,
        rationale: "RRHH verificó que cumple (Entrevista).",
      },
    ]);
  });

  it("no vota con «no cumple» (puede ser por años o nivel), ni en dudas de juicio, ni sin un término del motor", () => {
    expect(votesFromVerifications(engine, [{ requirementId: "a", result: "no_cumplido" }])).toEqual([]);
    expect(votesFromVerifications(engine, [{ requirementId: "b", result: "acreditado" }])).toEqual([]);
    expect(votesFromVerifications(engine, [{ requirementId: "c", result: "acreditado" }])).toEqual([]);
    expect(votesFromVerifications(engine, [{ requirementId: "x", result: "acreditado" }])).toEqual([]);
  });
});

describe("segundo juez y prompt v4", () => {
  it("el juez decide a ciegas: no se le dice qué opinó la IA", () => {
    const prompt = buildJudgePrompt({ category: "experiencia", description: OBRA.description, term: "Asistente de Residencia" });
    expect(prompt).toContain("«Asistente de Residencia»");
    expect(prompt).toContain(OBRA.description);
    expect(prompt).not.toMatch(/la IA|votos|confirm/i);
    expect(JUDGE_JSON_SCHEMA).not.toHaveProperty("$schema");
    expect(parseJudgeOutput({ equivalent: true, reason: " Es lo mismo. " })).toEqual({ equivalent: true, reason: "Es lo mismo." });
    expect(parseJudgeOutput({ equivalent: "si" })).toBeNull();
  });

  it("v4 pide el término que resolvió la duda", () => {
    expect(PROMPT_VERSION).toBe("ia-prompt-v4");
    expect(SYSTEM_PROMPT).toMatch(/"equivalence"/);
  });

  it("lo resuelto por una regla aprendida va a la IA como control, con el término a confirmar", () => {
    const learned = [rule("Asistente de Residencia", "equivale")];
    const notes = buildEngineNotes(
      [item(OBRA.id, "acreditado", { resolvedBy: "regla_aprendida", learnedRuleId: learned[0]!.id })],
      { learned },
    );
    expect(notes.perRequirement[OBRA.id]).toMatch(/Control de una regla aprendida/);
    expect(notes.perRequirement[OBRA.id]).toContain("«Asistente de Residencia» cuenta");
    const message = buildUserMessage({ vacancyTitle: "Residente", requirements: [OBRA], resumeText: "x", engineNotes: notes });
    expect(message).toContain("nota del motor: Control de una regla aprendida");
  });
});
