import { describe, expect, it } from "vitest";
import { buildReportHref, parseDetailParam, portalRobotLabel } from "@/modules/reports/detail";
import type { BotPortalStatus } from "@/modules/portals/queries";

describe("detalle del reporte (URL)", () => {
  it("acepta etapa, fuente y portal conocidos", () => {
    expect(parseDetailParam("etapa:en_revision")).toEqual({ kind: "etapa", value: "en_revision" });
    expect(parseDetailParam("fuente:linkedin")).toEqual({ kind: "fuente", value: "linkedin" });
    expect(parseDetailParam("portal:Computrabajo")).toEqual({ kind: "portal", value: "Computrabajo" });
    expect(parseDetailParam("portal:Bumeran: Perú")).toEqual({ kind: "portal", value: "Bumeran: Perú" });
  });

  it("ignora sin error lo desconocido o mal formado", () => {
    for (const raw of [undefined, "", ":", "etapa", "etapa:", "etapa:inventada", "fuente:x", "otro:abc", "etapa:__proto__", "portal:", "portal:a\nb"]) {
      expect(parseDetailParam(raw)).toBeUndefined();
    }
    expect(parseDetailParam(["etapa:nuevo", "etapa:en_revision"])).toBeUndefined();
    expect(parseDetailParam("portal:" + "x".repeat(200))).toBeUndefined();
  });

  it("arma el enlace conservando los filtros y con el ancla", () => {
    const filters = { vacante: "3f2b8c1e-0000-4000-8000-000000000001", desde: "2026-01-01" };
    expect(buildReportHref(filters, { kind: "etapa", value: "en_revision" })).toBe(
      "/reportes?vacante=3f2b8c1e-0000-4000-8000-000000000001&desde=2026-01-01&detalle=etapa%3Aen_revision#detalle",
    );
    expect(buildReportHref(filters)).toBe("/reportes?vacante=3f2b8c1e-0000-4000-8000-000000000001&desde=2026-01-01");
    expect(buildReportHref({})).toBe("/reportes");
    expect(buildReportHref({}, { kind: "portal", value: "A&B" })).toBe("/reportes?detalle=portal%3AA%26B#detalle");
  });
});

describe("estado del robot por portal", () => {
  const status = (nivel: BotPortalStatus["nivel"], reason: string | null = null): BotPortalStatus => ({
    portalName: "P",
    nivel,
    reason,
    seenAt: nivel === "sin_datos" ? null : "2026-01-01T00:00:00Z",
  });

  it("traduce a encendido, en reparación o sin señal", () => {
    expect(portalRobotLabel(status("ok"))?.label).toBe("Encendido");
    expect(portalRobotLabel(status("error", "selector"))?.label).toBe("En reparación");
    expect(portalRobotLabel(status("atencion", "sesion_expirada"))?.label).toBe("En reparación");
    expect(portalRobotLabel(status("atencion", "sin_senal"))?.label).toBe("Sin señal");
    expect(portalRobotLabel(status("sin_datos"))?.label).toBe("Sin señal");
  });

  it("devuelve null si el robot no atiende el portal", () => {
    expect(portalRobotLabel(undefined)).toBeNull();
  });
});
