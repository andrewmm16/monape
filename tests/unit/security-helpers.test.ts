import { describe, expect, it } from "vitest";
import { can, PERMISSIONS } from "@/lib/auth/permissions";
import { AppError, toAppError } from "@/lib/errors";
import { safeNextPath } from "@/lib/safe-redirect";

describe("matriz de permisos", () => {
  it("RRHH gestiona el proceso pero no usuarios ni auditoría", () => {
    expect(can("rrhh", "evaluations:run")).toBe(true);
    expect(can("rrhh", "users:manage")).toBe(false);
    expect(can("rrhh", "audit:read")).toBe(false);
  });

  it("sin rol no hay permisos", () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(can(null, permission)).toBe(false);
    }
  });
});

describe("redirecciones seguras", () => {
  it("acepta rutas internas conocidas", () => {
    expect(safeNextPath("/vacantes/123?tab=candidatos")).toBe("/vacantes/123?tab=candidatos");
    expect(safeNextPath("/restablecer")).toBe("/restablecer");
  });

  it("rechaza redirecciones abiertas", () => {
    for (const value of [
      "https://malicioso.test",
      "//malicioso.test",
      "/\\malicioso.test",
      "javascript:alert(1)",
      "/api/resumes/1/download",
      "/ingresar",
      "",
      null,
      "/vacantes\u0000",
    ]) {
      expect(safeNextPath(value)).toBe("/panel");
    }
  });
});

describe("errores de base de datos", () => {
  it("no exponen detalles internos", () => {
    const error = toAppError({ code: "XX000", message: "relation \"secret_table\" does not exist; key=abc" });
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).not.toContain("secret_table");
  });

  it("traducen permisos denegados y reglas de negocio", () => {
    expect(toAppError({ code: "42501", message: "new row violates row-level security policy" }).code).toBe("forbidden");
    const rule = toAppError({ code: "RH422", message: "Debe indicar el motivo del cambio de estado" });
    expect(rule.message).toBe("Debe indicar el motivo del cambio de estado");
    expect(rule.code).toBe("validation");
  });
});
