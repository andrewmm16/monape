import { z } from "zod";
import { Constants } from "@/types/database";

const emailCheck = z.email();

/** Texto opcional: vacío → null; si tiene valor, se valida con `check`. */
function optional(max: number, check?: { test: (value: string) => boolean; message: string }) {
  return z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .refine((value) => value === "" || !check || check.test(value), check?.message ?? "Valor inválido")
    .transform((value) => (value === "" ? null : value));
}

export const candidateFormSchema = z.object({
  fullName: z.string().trim().min(2, "Ingrese el nombre completo").max(160, "Máximo 160 caracteres"),
  email: optional(254, { test: (v) => emailCheck.safeParse(v).success, message: "Correo inválido" }).transform(
    (value) => value?.toLowerCase() ?? null,
  ),
  phone: optional(40, { test: (v) => /^[+0-9()\s.-]{6,}$/.test(v), message: "Use solo números, espacios y + ( ) -" }),
  location: optional(160),
  linkedinUrl: optional(300, {
    test: (v) => /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/\S+$/i.test(v),
    message: "Debe ser un enlace https de linkedin.com",
  }),
  source: z.enum(Constants.public.Enums.candidate_source),
  sourceDetail: optional(200),
});

export type CandidateFormInput = z.input<typeof candidateFormSchema>;
export type CandidateFormValues = z.output<typeof candidateFormSchema>;

/** Campos de la ficha cuyo origen (declarado/extraído/verificado) se registra. */
export const TRACKED_FIELDS = ["full_name", "email", "phone", "location", "linkedin_url"] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export const TRACKED_FIELD_LABELS: Record<TrackedField, string> = {
  full_name: "Nombre",
  email: "Correo",
  phone: "Teléfono",
  location: "Ubicación",
  linkedin_url: "LinkedIn",
};

export const createCandidateSchema = candidateFormSchema.extend({
  vacancyId: z.uuid().or(z.literal("").transform(() => null)),
  confirmDuplicate: z.boolean().default(false),
});

export type CreateCandidateInput = z.input<typeof createCandidateSchema>;

const dateCheck = { test: (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v), message: "Fecha inválida" };

export const profileItemSchema = z
  .object({
    kind: z.enum(Constants.public.Enums.profile_item_kind),
    title: z.string().trim().min(1, "Requerido").max(200, "Máximo 200 caracteres"),
    organization: optional(200),
    startDate: optional(10, dateCheck),
    endDate: optional(10, dateCheck),
    description: optional(2000),
    origin: z.enum(Constants.public.Enums.data_origin),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "La fecha de fin no puede ser anterior a la de inicio",
    path: ["endDate"],
  });

export type ProfileItemInput = z.input<typeof profileItemSchema>;
