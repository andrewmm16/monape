import { z } from "zod";

/** Esquemas de entrada del Reclutador Caleta (prospectos de sourcing). */

export const CALETA_SOURCES = ["linkedin", "cip", "grupo", "google", "referido", "otro"] as const;
export const CALETA_STATUSES = [
  "encontrado",
  "contactado",
  "conectado",
  "respondio",
  "interesado",
  "descartado",
  "derivado",
] as const;

/** Estados que RRHH puede fijar a mano (derivado lo pone deriveProspect al crear el candidato). */
export const SELECTABLE_CALETA_STATUSES = [
  "encontrado",
  "contactado",
  "conectado",
  "respondio",
  "interesado",
  "descartado",
] as const;

/** Canales por los que se registra el primer contacto saliente. */
export const CALETA_CONTACT_CHANNELS = ["linkedin", "whatsapp", "email", "otro"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine((value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), {
    message: "Correo no válido.",
  });

export const prospectCreateSchema = z.object({
  vacancyId: z.uuid(),
  fullName: z.string().trim().min(2, "Indique el nombre.").max(160),
  headline: optionalText(300),
  location: optionalText(160),
  linkedinUrl: optionalText(300),
  source: z.enum(CALETA_SOURCES).default("linkedin"),
  sourceDetail: optionalText(200),
  profileText: z
    .string()
    .trim()
    .min(50, "Pega el texto del perfil (al menos unas líneas) para poder puntuarlo.")
    .max(200_000),
  email: optionalEmail,
  phone: optionalText(40),
});

export const prospectContactSchema = z.object({
  id: z.uuid(),
  phone: optionalText(40),
  email: optionalEmail,
});

export const prospectStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(SELECTABLE_CALETA_STATUSES),
  notes: optionalText(4000),
});

export const prospectContactedSchema = z.object({
  id: z.uuid(),
  channel: z.enum(CALETA_CONTACT_CHANNELS).default("linkedin"),
  message: optionalText(4000),
});

/** La persona aceptó la invitación de LinkedIn: se registra el mensaje directo que se le envía. */
export const prospectConnectedSchema = z.object({
  id: z.uuid(),
  message: optionalText(4000),
});

export type ProspectCreateInput = z.input<typeof prospectCreateSchema>;
export type ProspectConnectedInput = z.input<typeof prospectConnectedSchema>;
export type ProspectContactInput = z.input<typeof prospectContactSchema>;
export type ProspectStatusInput = z.input<typeof prospectStatusSchema>;
export type ProspectContactedInput = z.input<typeof prospectContactedSchema>;
