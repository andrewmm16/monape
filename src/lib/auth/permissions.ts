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
  "email_templates:manage": ["admin", "rrhh"],
  "vacancies:manage": ["admin", "rrhh"],
  "vacancies:delete": ["admin"],
  "candidates:manage": ["admin", "rrhh"],
  // Plazo de conservación: anonimizar es irreversible.
  "candidates:anonymize": ["admin"],
  // Reclutador Caleta: sourcing de prospectos. Lo comparten admin y rrhh; el rol
  // reclutador_caleta solo tiene este permiso (no gestiona candidatos ni deriva).
  "caleta:use": ["admin", "rrhh", "reclutador_caleta"],
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
  reclutador_caleta: "Reclutador Caleta",
};
