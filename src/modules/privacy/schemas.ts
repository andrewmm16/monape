import { z } from "zod";

export const NOTICE_TITLE_MAX = 200;
export const NOTICE_BODY_MAX = 20_000;

export const noticeFormSchema = z.object({
  title: z.string().trim().min(1, "Indique el título").max(NOTICE_TITLE_MAX, `Máximo ${NOTICE_TITLE_MAX} caracteres`),
  body: z.string().trim().min(1, "Indique el texto del aviso").max(NOTICE_BODY_MAX, "Máximo 20 000 caracteres"),
});
export type NoticeFormInput = z.input<typeof noticeFormSchema>;

export const activateNoticeSchema = z.object({
  approvalReference: z
    .string()
    .trim()
    .min(1, "Indique la referencia de aprobación")
    .max(500, "Máximo 500 caracteres"),
  confirmed: z.literal(true, { error: "Confirme que el área legal aprobó este texto" }),
});
export type ActivateNoticeInput = z.input<typeof activateNoticeSchema>;
