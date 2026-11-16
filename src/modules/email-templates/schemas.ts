import { z } from "zod";
import { EMAIL_TEMPLATE_KEYS } from "./defaults";

export const TEMPLATE_SUBJECT_MAX = 200;
export const TEMPLATE_BODY_MAX = 5000;

export const saveTemplateSchema = z.object({
  key: z.enum(EMAIL_TEMPLATE_KEYS),
  subject: z.string().trim().min(1, "Indique el asunto").max(TEMPLATE_SUBJECT_MAX, `Máximo ${TEMPLATE_SUBJECT_MAX} caracteres`),
  body: z
    .string()
    .trim()
    .min(1, "Indique el cuerpo del mensaje")
    .max(TEMPLATE_BODY_MAX, `Máximo ${TEMPLATE_BODY_MAX} caracteres`),
});
export type SaveTemplateInput = z.input<typeof saveTemplateSchema>;
