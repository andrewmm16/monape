import { z } from "zod";
import { AUDIT_GROUP_KEYS } from "./labels";

const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(new Date(`${value}T12:00:00-05:00`).getTime()))
  .or(z.literal(""))
  .catch("");

export const auditParamsSchema = z.object({
  /** Vacío = solo acciones de personas; `todos` = también robot y sistema; `sistema` = solo acciones sin persona. */
  actor: z.uuid().or(z.literal("sistema")).or(z.literal("todos")).or(z.literal("")).catch(""),
  group: z.enum(AUDIT_GROUP_KEYS).or(z.literal("")).catch(""),
  from: dateParam,
  to: dateParam,
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type AuditParams = z.infer<typeof auditParamsSchema>;
