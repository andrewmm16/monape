import { z } from "zod";

/** Tamaño máximo del cuerpo de la solicitud (JSON con el CV en base64). */
export const MAX_BODY_BYTES = 6 * 1024 * 1024;

// Misma forma que el CHECK de candidates.email.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || undefined);

/**
 * Carga que envía Talent Apply. Solo se leen los campos que se usan:
 * `analytics` (IP, user agent), `questions`, `job` y cualquier otro se descartan
 * en el análisis y nunca se guardan. La vacante sale de la URL, no del cuerpo.
 */
export const talentApplyPayloadSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(z.string().min(1).max(200)),
  applicant: z.object({
    fullName: z.string().trim().min(2).max(160),
    email: z.string().trim().max(254).regex(EMAIL_PATTERN),
    // Talent.com podría enviar el teléfono como número: se acepta y se pasa a texto.
    phoneNumber: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((value) => (value == null ? undefined : String(value).trim() || undefined))
      .pipe(z.string().max(40).optional()),
    resume: z.object({
      file: z.object({
        fileName: optionalText(255),
        contentType: optionalText(200),
        data: z.string().min(1),
      }),
    }),
  }),
});

export type TalentApplyPayload = z.infer<typeof talentApplyPayloadSchema>;
