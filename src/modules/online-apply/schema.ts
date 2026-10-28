import { z } from "zod";
import { candidateFormSchema } from "@/modules/candidates/schemas";

/**
 * Datos del formulario público. Reutiliza las validaciones de la ficha de
 * candidato; correo y teléfono son obligatorios aquí.
 */
export const onlineApplicationSchema = z.object({
  fullName: candidateFormSchema.shape.fullName,
  email: candidateFormSchema.shape.email.refine((value) => value !== null, "Ingrese su correo electrónico"),
  phone: candidateFormSchema.shape.phone.refine((value) => value !== null, "Ingrese su teléfono"),
  location: candidateFormSchema.shape.location,
  linkedinUrl: candidateFormSchema.shape.linkedinUrl,
  acceptNotice: z.boolean().refine((value) => value, "Debe aceptar el aviso de privacidad para postular"),
  acceptTalentPool: z.boolean(),
  noticeId: z.uuid("Recargue la página e inténtelo nuevamente"),
});

export type OnlineApplicationValues = z.output<typeof onlineApplicationSchema>;

/** Casilla de un formulario HTML: «on»/«true» marcada; cualquier otra cosa, no. */
export function checkboxValue(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true";
}

export function textValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}
