import { describe, expect, it } from "vitest";
import { buildInbox, INBOX_PARTIAL_SCORE, type InboxCandidate } from "@/modules/evaluation/inbox";
import type { GuideQuestion } from "@/modules/evaluation/interview-guide";

const q = (
  requirementId: string,
  priority: GuideQuestion["priority"],
  assessment: GuideQuestion["assessment"] = "pendiente_verificacion",
  kind: GuideQuestion["kind"] = "abierto",
): GuideQuestion => ({
  requirementId,
  description: requirementId,
  priority,
  assessment,
  kind,
  reason: "Motivo.",
  question: "¿Pregunta?",
  passIf: "Cumple si…",
  source: "motor",
});

const cand = (name: string, score: number, guide: GuideQuestion[]): InboxCandidate => ({
  applicationId: name,
  candidateName: name,
  status: "nuevo",
  score,
  potential: 100,
  guide,
});

describe("bandeja de la vacante", () => {
  const inbox = buildInbox(
    [
      cand("Ana", 84, [q("deseable", "deseable", "sin_evidencia")]),
      cand("Beto", 100, []),
      // Parcial: falta un obligatorio que el CV no menciona, pero ya tiene 63 %.
      cand("Carla", 63, [q("excel", "obligatorio", "sin_evidencia"), q("ingles", "deseable")]),
      // Poca puntuación, pero con un indicio del obligatorio que falta.
      cand("Dina", 19, [q("planillas", "obligatorio", "pendiente_verificacion")]),
      // Acreditado por el motor, en duda por la IA: también es un indicio.
      cand("Elio", 30, [q("rrhh", "obligatorio", "acreditado", "duda_ia"), q("excel", "obligatorio", "sin_evidencia")]),
      // Sin indicios y con menos de 40 %: el CV no muestra lo obligatorio.
      cand("Fito", 0, [q("planillas", "obligatorio", "sin_evidencia"), q("excel", "obligatorio", "sin_evidencia")]),
      cand("Gina", INBOX_PARTIAL_SCORE - 1, [q("planillas", "obligatorio", "no_cumplido")]),
    ],
    2,
  );

  it("listos: todos los obligatorios acreditados (los deseables se cuentan), por puntuación", () => {
    expect(inbox.ready.map((e) => e.candidateName)).toEqual(["Beto", "Ana"]);
    expect(inbox.ready[1]!.optionalCount).toBe(1);
  });

  it("por confirmar: compatibilidad parcial o un indicio de lo que falta; por puntuación", () => {
    expect(inbox.toConfirm.map((e) => e.candidateName)).toEqual(["Carla", "Elio", "Dina"]);
    expect(inbox.toConfirm[0]!.mandatory.map((m) => m.requirementId)).toEqual(["excel"]);
    expect(inbox.toConfirm[0]!.optionalCount).toBe(1);
  });

  it("sin evidencia de los obligatorios: menos de 40 % y ningún indicio; nadie se descarta, solo se agrupa", () => {
    expect(inbox.noEvidence.map((e) => e.candidateName)).toEqual(["Gina", "Fito"]);
    expect(inbox.ready.length + inbox.toConfirm.length + inbox.noEvidence.length).toBe(7);
    expect(inbox.notEvaluated).toBe(2);
  });
});
