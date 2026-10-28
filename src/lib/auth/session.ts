import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError } from "@/lib/errors";
import { can, type AppRole, type Permission } from "@/lib/auth/permissions";

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
};

export type SessionState =
  | { status: "anonymous" }
  | { status: "inactive"; userId: string }
  | { status: "active"; user: SessionUser };

/**
 * Lee la sesión del usuario (JWT verificado por Supabase) y su perfil.
 * Se memoriza por solicitud con `cache` de React.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return { status: "anonymous" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return { status: "anonymous" };
  // Solo los perfiles eliminados no tienen rol (y además están inactivos).
  if (!profile.is_active || !profile.role) return { status: "inactive", userId };

  return {
    status: "active",
    user: { id: profile.id, email: profile.email, fullName: profile.full_name, role: profile.role },
  };
});

// --- Server Actions y Route Handlers: lanzan AppError ----------------------

export async function requireActiveUser(): Promise<SessionUser> {
  const state = await getSessionState();
  if (state.status === "active") return state.user;
  if (state.status === "inactive") {
    throw new AppError("Su cuenta está desactivada.", "forbidden");
  }
  throw new AppError("Su sesión expiró. Vuelva a iniciar sesión.", "unauthenticated");
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireActiveUser();
  if (!can(user.role, permission)) {
    throw new AppError("No tiene permisos para realizar esta acción.", "forbidden");
  }
  return user;
}

// --- Páginas: redirigen -----------------------------------------------------

export async function requirePageUser(): Promise<SessionUser> {
  const state = await getSessionState();
  if (state.status === "active") return state.user;
  if (state.status === "inactive") redirect("/auth/cuenta-desactivada");
  redirect("/ingresar");
}
