import { z } from "zod";
import { Constants } from "@/types/database";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .transform((value) => (value === "" ? null : value));

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "Fecha inválida")
  .transform((value) => (value === "" ? null : value));

const optionalAmount = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{1,9}([.,]\d{1,2})?$/.test(value), "Monto inválido")
  .transform((value) => (value === "" ? null : Number(value.replace(",", "."))));

export const vacancyFormSchema = z
  .object({
    title: z.string().trim().min(3, "Mínimo 3 caracteres").max(200, "Máximo 200 caracteres"),
    department: z.string().trim().min(2, "Indique el área").max(120, "Máximo 120 caracteres"),
    description: z.string().trim().max(10_000, "Máximo 10 000 caracteres"),
    responsibilities: z.string().trim().max(10_000, "Máximo 10 000 caracteres"),
    location: optionalText(200),
    modality: z.enum(Constants.public.Enums.work_modality).or(z.literal("").transform(() => null)),
    contractType: optionalText(120),
    openingDate: optionalDate,
    closingDate: optionalDate,
    ownerId: z.uuid().or(z.literal("").transform(() => null)),
    // Publicación (2.9)
    city: optionalText(100),
    region: optionalText(100),
    employmentType: z.enum(Constants.public.Enums.employment_type).or(z.literal("").transform(() => null)),
    salaryMin: optionalAmount,
    salaryMax: optionalAmount,
    salaryCurrency: z.enum(["PEN", "USD"]).or(z.literal("").transform(() => null)),
    salaryPeriod: z.enum(Constants.public.Enums.salary_period).or(z.literal("").transform(() => null)),
    isConfidential: z.boolean(),
  })
  .refine((v) => !v.openingDate || !v.closingDate || v.closingDate >= v.openingDate, {
    message: "La fecha de cierre no puede ser anterior a la de apertura",
    path: ["closingDate"],
  })
  .superRefine((v, ctx) => {
    // El sueldo es opcional; si se informa, exige mínimo, moneda y periodo.
    // Se admite solo el mínimo (monto fijo), nunca solo el máximo.
    if (v.salaryMin === null && v.salaryMax === null) return;
    if (v.salaryMin === null) {
      ctx.addIssue({ code: "custom", path: ["salaryMin"], message: "Indique el sueldo mínimo" });
    } else if (v.salaryMax !== null && v.salaryMax < v.salaryMin) {
      ctx.addIssue({ code: "custom", path: ["salaryMax"], message: "El máximo no puede ser menor que el mínimo" });
    }
    if (!v.salaryCurrency) ctx.addIssue({ code: "custom", path: ["salaryCurrency"], message: "Indique la moneda" });
    if (!v.salaryPeriod) ctx.addIssue({ code: "custom", path: ["salaryPeriod"], message: "Indique el periodo" });
  })
  // Sin sueldo no se guardan moneda ni periodo (la base de datos lo exige).
  .transform((v) =>
    v.salaryMin === null ? { ...v, salaryMax: null, salaryCurrency: null, salaryPeriod: null } : v,
  );

export type VacancyFormInput = z.input<typeof vacancyFormSchema>;
export type VacancyFormValues = z.output<typeof vacancyFormSchema>;

export const requirementFormSchema = z.object({
  category: z.enum(Constants.public.Enums.requirement_category),
  priority: z.enum(Constants.public.Enums.requirement_priority),
  description: z.string().trim().min(2, "Describa el requisito").max(500, "Máximo 500 caracteres"),
  keywords: z
    .string()
    .max(1000)
    .transform((value) =>
      [...new Set(value.split(/[,;\n]/).map((k) => k.trim()).filter(Boolean))],
    )
    .refine((list) => list.length <= 20, "Máximo 20 términos")
    .refine((list) => list.every((k) => k.length <= 60), "Cada término admite hasta 60 caracteres"),
  weight: z.coerce.number().int("Use un número entero").min(1, "Mínimo 1").max(10, "Máximo 10"),
  minYears: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,2}([.,]\d)?$/.test(v) && Number(v.replace(",", ".")) <= 50), "Entre 0 y 50")
    .transform((v) => (v === "" ? null : Number(v.replace(",", ".")))),
  isEssential: z.boolean(),
});

export type RequirementFormInput = z.input<typeof requirementFormSchema>;

export const vacancyStatusSchema = z.enum(Constants.public.Enums.vacancy_status);

/** Transiciones de estado permitidas para una vacante. */
export const VACANCY_TRANSITIONS: Record<z.infer<typeof vacancyStatusSchema>, z.infer<typeof vacancyStatusSchema>[]> = {
  borrador: ["publicada", "archivada"],
  publicada: ["cerrada"],
  cerrada: ["publicada", "archivada"],
  archivada: [],
};

export function canTransitionVacancy(
  from: z.infer<typeof vacancyStatusSchema>,
  to: z.infer<typeof vacancyStatusSchema>,
): boolean {
  return VACANCY_TRANSITIONS[from].includes(to);
}
