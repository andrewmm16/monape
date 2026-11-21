import { computeScores, determineLevel, LEVEL_RULES } from "@/modules/evaluation/scoring";
import type { ItemAssessment, RequirementInput } from "@/modules/evaluation/types";
import type { Enums } from "@/types/database";

/**
 * Talento sugerido con el motor (docs/superpowers/specs/2026-11-20-talento-y-autoagenda-design.md):
 * ordena a las personas de la base de talentos según cómo el motor de reglas
 * evaluó su CV frente a los requisitos de la vacante. Puro y determinista: no
 * guarda nada ni crea postulaciones.
 */

export type RankedTalent = {
  candidateId: string;
  score: number;
  level: Enums<"compatibility_level">;
  mandatoryMet: number;
  mandatoryTotal: number;
  /** Obligatorios que el CV no acredita, en el orden de la vacante. */
  missingMandatory: string[];
  /** Requisitos que el CV acredita, en el orden de la vacante. */
  accredited: string[];
};

/** Mínimo de texto para evaluar un CV (el mismo que la evaluación de una postulación). */
const MIN_TEXT_LENGTH = 50;
const DEFAULT_LIMIT = 20;

/** Texto del CV para el motor: el corregido por RRHH si existe; null si no hay texto legible. */
export function resumeTextOf(extraction: { raw_text: string | null; corrected_text: string | null } | null): string | null {
  const text = (extraction?.corrected_text ?? extraction?.raw_text ?? "").trim();
  return text.length >= MIN_TEXT_LENGTH ? text : null;
}

/**
 * Entran quienes llegan al corte de «parcial» (40 %) o cumplen todos los
 * obligatorios. Orden: obligatorios cumplidos, cumplimiento, nombre.
 */
export function rankTalent(
  entries: { candidateId: string; name: string; requirements: RequirementInput[]; items: ItemAssessment[] }[],
  limit: number = DEFAULT_LIMIT,
): RankedTalent[] {
  const ranked = entries.flatMap((entry) => {
    const byId = new Map(entry.items.map((item) => [item.requirementId, item.assessment]));
    const rows = entry.requirements.map((r) => ({ requirement: r, assessment: byId.get(r.id) ?? "sin_evidencia" }));
    if (rows.length === 0) return [];
    const scores = computeScores(rows.map((row) => ({ weight: row.requirement.weight, assessment: row.assessment })));
    const mandatory = rows.filter((row) => row.requirement.priority === "obligatorio");
    const mandatoryMet = mandatory.filter((row) => row.assessment === "acreditado").length;
    const allMandatory = mandatory.length > 0 && mandatoryMet === mandatory.length;
    if (scores.score < LEVEL_RULES.partial && !allMandatory) return [];
    return [
      {
        name: entry.name,
        talent: {
          candidateId: entry.candidateId,
          score: scores.score,
          level: determineLevel(
            scores,
            rows.map((row) => ({ priority: row.requirement.priority, assessment: row.assessment })),
          ),
          mandatoryMet,
          mandatoryTotal: mandatory.length,
          missingMandatory: mandatory.filter((row) => row.assessment !== "acreditado").map((row) => row.requirement.description),
          accredited: rows.filter((row) => row.assessment === "acreditado").map((row) => row.requirement.description),
        } satisfies RankedTalent,
      },
    ];
  });
  ranked.sort(
    (a, b) => b.talent.mandatoryMet - a.talent.mandatoryMet || b.talent.score - a.talent.score || a.name.localeCompare(b.name, "es"),
  );
  return ranked.slice(0, limit).map((r) => r.talent);
}
