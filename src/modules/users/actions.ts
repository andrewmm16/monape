"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseInput, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env";
import { AppError, logServerError, toAppError } from "@/lib/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Constants } from "@/types/database";
import { inviteUserSchema, type InviteUserInput } from "@/modules/auth/schemas";

/**
 * Invita a un usuario interno. No existe registro público: solo un
 * administrador puede dar acceso. La invitación usa la clave secreta (solo
 * servidor) y el rol se asigna con la sesión del administrador (RLS).
 */
export async function inviteUser(input: InviteUserInput): Promise<ActionResult> {
  return runAction(
    "users.invite",
    async () => {
      await requirePermission("users:manage");
      const values = parseInput(inviteUserSchema, input);
      const supabase = await createSupabaseServerClient();
      await enforceRateLimit(supabase, RATE_LIMITS.userInvite);

      const admin = createSupabaseAdminClient();
      const { APP_URL } = getServerEnv();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(values.email, {
        data: { full_name: values.fullName },
        redirectTo: `${APP_URL}/auth/confirm?next=/restablecer`,
      });
      if (error || !data.user) {
        logServerError("users.invite", { code: error?.code ?? error?.status });
        throw new AppError(
          error?.code === "email_exists"
            ? "Ya existe un usuario con ese correo."
            : "No se pudo enviar la invitación. Verifique la configuración de correo de Supabase.",
          "conflict",
        );
      }

      // La cuenta nace desactivada y sin el rol (Auth guarda app_metadata
      // después del alta): el administrador la activa con el rol elegido.
      const { error: roleError } = await supabase
        .from("profiles")
        .update({ role: values.role, full_name: values.fullName, is_active: true })
        .eq("id", data.user.id);
      if (roleError) throw toAppError(roleError);
      revalidatePath("/usuarios");
      return null;
    },
    "Invitación enviada.",
  );
}

const updateUserSchema = z.object({
  userId: z.uuid(),
  role: z.enum(Constants.public.Enums.app_role).optional(),
  isActive: z.boolean().optional(),
});

export async function updateUser(input: z.input<typeof updateUserSchema>): Promise<ActionResult> {
  return runAction(
    "users.update",
    async () => {
      const current = await requirePermission("users:manage");
      const values = parseInput(updateUserSchema, input);
      if (values.userId === current.id) {
        throw new AppError("No puede modificar su propio rol ni desactivar su propia cuenta.", "forbidden");
      }

      const supabase = await createSupabaseServerClient();
      const patch: { role?: (typeof values)["role"]; is_active?: boolean } = {};
      if (values.role) patch.role = values.role;
      if (values.isActive !== undefined) patch.is_active = values.isActive;

      const { data, error } = await supabase.from("profiles").update(patch).eq("id", values.userId).select("id");
      if (error) throw toAppError(error);
      if (!data?.length) throw new AppError("Usuario no encontrado.", "not_found");

      // Al desactivar, además se bloquea la cuenta en Supabase Auth para
      // impedir la renovación de sesiones existentes.
      if (values.isActive !== undefined && getServerEnv().SUPABASE_SECRET_KEY) {
        const admin = createSupabaseAdminClient();
        const { error: banError } = await admin.auth.admin.updateUserById(values.userId, {
          ban_duration: values.isActive ? "none" : "876000h",
        });
        if (banError) {
          logServerError("users.ban", { code: banError.code ?? banError.status });
          throw new AppError("El perfil se actualizó, pero no se pudo actualizar el bloqueo de la cuenta.", "unavailable");
        }
      }
      revalidatePath("/usuarios");
      revalidatePath("/usuarios/papelera");
      return null;
    },
    "Usuario actualizado.",
  );
}

/**
 * Elimina definitivamente a un usuario de la papelera: borra su cuenta de
 * Supabase Auth (correo, contraseña y sesiones). Un disparador conserva el
 * perfil, sin correo, solo para que el historial muestre su nombre.
 */
export async function deleteUser(userId: string): Promise<ActionResult> {
  return runAction(
    "users.delete",
    async () => {
      const current = await requirePermission("users:manage");
      const id = parseInput(z.uuid(), userId);
      if (id === current.id) throw new AppError("No puede eliminar su propia cuenta.", "forbidden");

      // Con la sesión del administrador: comprueba que esté en la papelera y
      // registra quién pidió la eliminación.
      const supabase = await createSupabaseServerClient();
      const { error } = await supabase.rpc("log_user_deletion", { p_user_id: id });
      if (error) throw toAppError(error);

      const admin = createSupabaseAdminClient();
      const { error: deleteError } = await admin.auth.admin.deleteUser(id);
      if (deleteError) {
        logServerError("users.delete", { code: deleteError.code ?? deleteError.status });
        throw new AppError("No se pudo eliminar la cuenta. Intente nuevamente.", "unavailable");
      }
      revalidatePath("/usuarios/papelera");
      return null;
    },
    "Usuario eliminado definitivamente.",
  );
}
