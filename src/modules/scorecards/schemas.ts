import { z } from "zod";
import { COMPETENCY_KEYS, SCORE_MAX, SCORE_MIN } from "./defaults";

export const SCORECARD_COMMENT_MAX = 2000;
export const SCORE_COMMENT_MAX = 500;

export const scoreItemSchema = z.object({
  competency: z.enum(COMPETENCY_KEYS),
  score: z.coerce.number().int().min(SCORE_MIN).max(SCORE_MAX),
  comment: z.string().trim().max(SCORE_COMMENT_MAX).optional().default(""),
});

export const saveScorecardSchema = z.object({
  applicationId: z.uuid(),
  recommendation: z.enum(["avanza", "duda", "no_avanza"]),
  comment: z.string().trim().max(SCORECARD_COMMENT_MAX).optional().default(""),
  scores: z
    .array(scoreItemSchema)
    .length(COMPETENCY_KEYS.length)
    .refine((items) => new Set(items.map((item) => item.competency)).size === COMPETENCY_KEYS.length, {
      message: "Puntúa todas las competencias.",
    }),
});

export type SaveScorecardInput = z.input<typeof saveScorecardSchema>;
export type SaveScorecardValues = z.output<typeof saveScorecardSchema>;
