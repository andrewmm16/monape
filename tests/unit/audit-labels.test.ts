import { describe, expect, it } from "vitest";
import { describeAuditEntry } from "@/modules/audit/labels";
import { auditParamsSchema } from "@/modules/audit/schemas";

const ID = "3f2b8a52-6c1e-4d0a-9b1f-0a1b2c3d4e5f";

describe("describeAuditEntry", () => {
  it("traduce un cambio de estado de postulación con sus etiquetas", () => {
    const result = describeAuditEntry({
      action: "update",
      entity_type: "applications",
      entity_id: ID,
      metadata: { changed_fields: ["status"], status: { from: "en_revision", to: "preseleccionado" } },
    });
    expect(result.text).toBe("Cambió el estado de una postulación: En revisión → Preseleccionado");
    expect(result.href).toBe(`/postulaciones/${ID}`);
  });

  it("traduce el cambio de rol y la desactivación de un usuario", () => {
    expect(
      describeAuditEntry({
        action: "update",
        entity_type: "profiles",
        entity_id: ID,
        metadata: { role: { from: "rrhh", to: "admin" } },
      }).text,
    ).toBe("Cambió el rol de un usuario: Responsable de RRHH → Administrador");
    expect(
      describeAuditEntry({
        action: "update",
        entity_type: "profiles",
        entity_id: ID,
        metadata: { is_active: { from: true, to: false } },
      }).text,
    ).toBe("Desactivó a un usuario");
  });

  it("lista los campos cuando no hay valores de estado", () => {
    expect(
      describeAuditEntry({
        action: "update",
        entity_type: "vacancies",
        entity_id: ID,
        metadata: { changed_fields: ["title", "description"] },
      }).text,
    ).toBe("Modificó una vacante (campos: title, description)");
  });

  it("traduce acciones propias y enlaza con la vacante o el candidato", () => {
    expect(
      describeAuditEntry({
        action: "publicacion_portal_solicitada",
        entity_type: "portal_publications",
        entity_id: ID,
        metadata: { vacancy_id: ID, portal: "Trabajos Diarios" },
      }),
    ).toEqual({ text: "Pidió publicar en Trabajos Diarios", href: `/vacantes/${ID}` });
    expect(
      describeAuditEntry({ action: "cv_descargado", entity_type: "resumes", entity_id: ID, metadata: { candidate_id: ID } }),
    ).toEqual({ text: "Descargó un CV", href: `/candidatos/${ID}` });
  });

  it("no enlaza lo eliminado ni identificadores que no son UUID", () => {
    expect(describeAuditEntry({ action: "delete", entity_type: "vacancies", entity_id: ID, metadata: {} }).href).toBeNull();
    expect(describeAuditEntry({ action: "insert", entity_type: "vacancies", entity_id: "../x", metadata: {} }).href).toBeNull();
  });

  it("muestra el nombre técnico cuando no conoce la acción y tolera metadatos raros", () => {
    expect(describeAuditEntry({ action: "algo_nuevo", entity_type: "tabla_x", entity_id: null, metadata: null }).text).toBe(
      "algo_nuevo · tabla_x",
    );
    expect(describeAuditEntry({ action: "update", entity_type: "applications", entity_id: null, metadata: [1, 2] }).text).toBe(
      "Modificó una postulación",
    );
  });
});

describe("auditParamsSchema", () => {
  it("usa valores vacíos cuando los parámetros son inválidos", () => {
    expect(auditParamsSchema.parse({ actor: "x", group: "otro", from: "2026-13-45", to: "hoy", page: "-3" })).toEqual({
      actor: "",
      group: "",
      from: "",
      to: "",
      page: 1,
    });
  });

  it("acepta el actor «sistema», un grupo, fechas y página válidos", () => {
    expect(auditParamsSchema.parse({ actor: "sistema", group: "vacantes", from: "2026-10-01", to: "2026-10-30", page: "2" })).toEqual({
      actor: "sistema",
      group: "vacantes",
      from: "2026-10-01",
      to: "2026-10-30",
      page: 2,
    });
  });
});
