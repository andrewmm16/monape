"use server";

import { redirect } from "next/navigation";
import { touchActivityCookie } from "@/lib/auth/activity-cookie";
import { getServerEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { newPasswordSchema, passwordResetRequestSchema, signInSchema } from "./schemas";

/** `email` se devuelve para conservar el campo tras un error (nunca la contraseña). */
export type FormState = { error?: string; message?: string; fieldErrors?: Record<string, string[]>; email?: string };

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) (errors[String(issue.path[0] ?? "_")] ??= []).push(issue.message);
  return errors;
}

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  const parsed = signInSchema.safeParse({
    email,
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), email };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  // `email_provider_disabled` es un error de configuración de Auth, no de credenciales.
  if (error && (!error.status || error.status >= 500 || error.code === "email_provider_disabled")) {
    logServerError("auth.sign_in", { code: error.code ?? error.status ?? "sin_conexion" });
    return { error: "El servicio de autenticación no está disponible. Intente nuevamente en unos minutos.", email };
  }
  if (error || !data.user) {
    // Mensaje único: no revela si el correo existe.
    return { error: "Correo o contraseña incorrectos.", email };
  }

  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "Su cuenta está desactivada. Contacte al administrador." };
  }

  try {
    await touchActivityCookie(data.user.id);
  } catch (error) {
    // Sin la cookie de actividad el proxy cerraría la sesión en la primera página.
    logServerError("auth.sign_in", error);
    await supabase.auth.signOut({ scope: "local" });
    return { error: "El servicio de autenticación no está disponible. Intente nuevamente en unos minutos.", email };
  }
  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/ingresar");
}

export async function requestPasswordReset(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = passwordResetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues), email: String(formData.get("email") ?? "").slice(0, 254) };

  try {
    const supabase = await createSupabaseServerClient();
    const { APP_URL } = getServerEnv();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${APP_URL}/auth/confirm?next=/restablecer`,
    });
    if (error) logServerError("auth.reset", { code: error.code ?? error.status });
  } catch (error) {
    logServerError("auth.reset", error);
  }
  // Respuesta idéntica exista o no la cuenta (evita enumeración de usuarios).
  return {
    message: "Si el correo pertenece a una cuenta activa, recibirá un enlace para restablecer la contraseña.",
  };
}

export async function updatePassword(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues) };

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { error: "El enlace expiró. Solicite uno nuevo desde «¿Olvidó su contraseña?»." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    logServerError("auth.update_password", { code: error.code ?? error.status });
    return {
      error:
        error.code === "same_password"
          ? "La nueva contraseña debe ser distinta de la anterior."
          : "No se pudo actualizar la contraseña. Intente nuevamente.",
    };
  }
  redirect("/panel");
}
