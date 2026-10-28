import { z } from "zod";
import { Constants } from "@/types/database";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email("Correo inválido"));

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Ingrese su contraseña").max(128),
  next: z.string().max(300).optional(),
});

export const passwordResetRequestSchema = z.object({ email });

/** Política de contraseñas: longitud mínima 12 y combinación de letras y números. */
export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, "Mínimo 12 caracteres")
      .max(72, "Máximo 72 caracteres")
      .regex(/[A-Za-zÁÉÍÓÚáéíóúÑñ]/, "Incluya al menos una letra")
      .regex(/\d/, "Incluya al menos un número"),
    confirmation: z.string(),
  })
  .refine((v) => v.password === v.confirmation, {
    message: "Las contraseñas no coinciden",
    path: ["confirmation"],
  });

export type NewPasswordInput = z.input<typeof newPasswordSchema>;

export const inviteUserSchema = z.object({
  email,
  fullName: z.string().trim().min(2, "Ingrese el nombre").max(160),
  role: z.enum(Constants.public.Enums.app_role),
});

export type InviteUserInput = z.input<typeof inviteUserSchema>;
