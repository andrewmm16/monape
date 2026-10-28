import type { Enums } from "@/types/database";

export type AppRole = Enums<"app_role">;

/**
 * Matriz de permisos de la aplicación. La interfaz la usa para mostrar u
 * ocultar acciones; el servidor la usa para autorizar cada operación. La base
 * de datos aplica además sus propias políticas RLS (defensa en profundidad).
 */
export const PERMISSIONS = {
  "users:manage": ["admin"],
  "audit:read": ["admin"],
  "privacy:manage": ["admin"],
  "vacancies:manage": ["admin", "rrhh"],
  "vacancies:delete": ["admin"],
  "candidates:manage": ["admin", "rrhh"],
  "resumes:upload": ["admin", "rrhh"],
  "evaluations:run": ["admin", "rrhh"],
  "evaluations:review": ["admin", "rrhh"],
  "applications:manage": ["admin", "rrhh"],
  "applications:add_note": ["admin", "rrhh"],
} as const satisfies Record<string, readonly AppRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly AppRole[]).includes(role);
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrador",
  rrhh: "Responsable de RRHH",
};
