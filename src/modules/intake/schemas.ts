import { z } from "zod";
import { Constants } from "@/types/database";

/** Máximo de archivos por lote (también lo exige la base de datos). */
export const MAX_BATCH_ITEMS = 50;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const startBatchSchema = z.object({ vacancyId: z.uuid(), portalId: z.uuid() });

export const updateItemSchema = z.object({
  itemId: z.uuid(),
  fullName: z
    .string()
    .trim()
    .max(160, "Máximo 160 caracteres")
    .refine((value) => value === "" || value.length >= 2, "Mínimo 2 caracteres"),
  email: z
    .string()
    .trim()
    .max(254, "Máximo 254 caracteres")
    .refine((value) => value === "" || EMAIL.test(value), "Correo no válido"),
  phone: z.string().trim().max(40, "Máximo 40 caracteres"),
});

export type UpdateItemInput = z.input<typeof updateItemSchema>;

export const registerItemsSchema = z.object({
  batchId: z.uuid(),
  itemIds: z
    .array(z.uuid())
    .min(1, "Seleccione al menos un archivo")
    .max(MAX_BATCH_ITEMS)
    .transform((ids) => [...new Set(ids)]),
});

/** Parámetros de la bandeja de entrada (en la URL). */
export const inboxParamsSchema = z.object({
  vacancy: z.uuid().or(z.literal("")).catch(""),
  portal: z.uuid().or(z.literal("")).catch(""),
  method: z.enum(Constants.public.Enums.application_intake_method).or(z.literal("")).catch(""),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

export type InboxParams = z.infer<typeof inboxParamsSchema>;
