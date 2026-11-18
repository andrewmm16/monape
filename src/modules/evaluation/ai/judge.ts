import { z } from "zod";
import { REQUIREMENT_CATEGORY_LABELS } from "@/lib/labels";
import type { RequirementInput } from "../types";

/**
 * Segundo juez de las reglas aprendidas. Antes de que el motor aplique solo una
 * regla («Asistente de Residencia» cuenta como «supervisión de obras»), otro
 * modelo, más capaz (AI_JUDGE_MODEL), decide A CIEGAS: no se le dice qué opinó la
 * IA en los CV, para no sesgarlo. Si no coincide, la regla se rechaza.
 */

export const JUDGE_PROMPT_VERSION = "juez-v1";

export const JUDGE_SYSTEM_PROMPT = `Eres especialista en selección de personal en Perú. Decides si un término que aparece en currículos cuenta como lo que pide un requisito de una vacante. Es una regla general, no la evaluación de una persona: no hay datos personales. Responde solo con el JSON pedido.`;

export function buildJudgePrompt(input: {
  category: RequirementInput["category"];
  description: string;
  term: string;
}): string {
  return `Requisito de la vacante (categoría: ${REQUIREMENT_CATEGORY_LABELS[input.category]}):
«${input.description}»

En varios currículos aparece este término: «${input.term}»

¿Ese término, por sí mismo, cuenta como lo que pide el requisito? No consideres años, nivel ni fechas: eso se revisa aparte en cada CV.
- "equivalent": true si una persona de RRHH lo aceptaría como lo mismo o un equivalente directo; false si es algo distinto, de menor nivel o solo relacionado.
- "reason": una o dos frases en español.`;
}

const judgeOutputSchema = z.object({ equivalent: z.boolean(), reason: z.string() });

/** Esquema para el CLI (`--json-schema`), sin `$schema` (ver ai/input.ts). */
export const JUDGE_JSON_SCHEMA: Record<string, unknown> = (() => {
  const schema = { ...(z.toJSONSchema(judgeOutputSchema) as Record<string, unknown>) };
  delete schema.$schema;
  return schema;
})();

export function parseJudgeOutput(raw: unknown): { equivalent: boolean; reason: string } | null {
  const parsed = judgeOutputSchema.safeParse(raw);
  return parsed.success ? { equivalent: parsed.data.equivalent, reason: parsed.data.reason.trim().slice(0, 600) } : null;
}
