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
    ).toEqual({ text: "Pidió publicar en Trabajos Diarios", href: `/vacantes/${ID}`, details: [] });
    expect(
      describeAuditEntry({ action: "cv_descargado", entity_type: "resumes", entity_id: ID, metadata: { candidate_id: ID } }),
    ).toEqual({ text: "Descargó un CV", href: `/candidatos/${ID}`, details: [] });
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

describe("describeAuditEntry con nombres reales", () => {
  const VAC = "11111111-1111-4111-8111-111111111111";
  const PORTAL = "22222222-2222-4222-8222-222222222222";
  const CAND = "33333333-3333-4333-8333-333333333333";
  const APP = "44444444-4444-4444-8444-444444444444";
  const USER = "55555555-5555-4555-8555-555555555555";
  const ctx = {
    vacancies: { [VAC]: { title: "Contador general", code: "VAC-7" } },
    portals: { [PORTAL]: "LinkedIn" },
    candidates: { [CAND]: "Ana Pérez" },
    profiles: { [USER]: { name: "Luis Rojas", email: "luis@x.pe", role: "rrhh" } },
    requirements: {},
    links: { [`applications:${APP}`]: { candidateId: CAND, vacancyId: VAC } },
  };

  it("el robot publica: dice qué vacante y en qué portal", () => {
    const result = describeAuditEntry(
      { action: "publicacion_portal_publicada", entity_type: "portal_publications", entity_id: ID, metadata: { vacancy_id: VAC, portal_id: PORTAL, error_code: null } },
      ctx,
    );
    expect(result.text).toBe("El robot publicó la vacante «Contador general» en LinkedIn");
    expect(result.details).toContain("Portal: LinkedIn");
    expect(result.details).toContain("Vacante: «Contador general» (código VAC-7)");
  });

  it("alta de usuario y cambio de estado de postulación llevan nombres", () => {
    expect(
      describeAuditEntry({ action: "insert", entity_type: "profiles", entity_id: USER, metadata: { role: "rrhh" } }, ctx).text,
    ).toBe("Se creó la cuenta de Luis Rojas (invitación enviada a luis@x.pe)");
    expect(
      describeAuditEntry(
        { action: "update", entity_type: "applications", entity_id: APP, metadata: { status: { from: "en_revision", to: "preseleccionado" } } },
        ctx,
      ).text,
    ).toBe("Cambió el estado de la postulación de Ana Pérez: En revisión → Preseleccionado");
  });

  it("los campos modificados salen en español", () => {
    const { details } = describeAuditEntry(
      { action: "update", entity_type: "vacancies", entity_id: VAC, metadata: { changed_fields: ["title", "salary_min"] } },
      ctx,
    );
    expect(details).toContain("Campos modificados: título, sueldo mínimo");
  });
});

describe("describeAuditEntry con valor anterior y nuevo", () => {
  const empty = { vacancies: {}, portals: {}, candidates: {}, profiles: {}, requirements: {}, links: {} };

  it("muestra «de → a» con los valores escritos para una persona", () => {
    const { details } = describeAuditEntry(
      {
        action: "update",
        entity_type: "vacancies",
        entity_id: ID,
        metadata: {
          changed_fields: ["title", "is_confidential", "modality", "full_text"],
          changes: {
            title: { from: "Contador", to: "Contador senior" },
            is_confidential: { from: false, to: true },
            modality: { from: "presencial", to: "hibrido" },
          },
        },
      },
      empty,
    );
    expect(details).toContain("Título: Contador → Contador senior");
    expect(details).toContain("Confidencialidad: No → Sí");
    expect(details).toContain("Modalidad: Presencial → Híbrido");
    expect(details.some((line) => line.startsWith("También cambió:"))).toBe(true);
  });

  it("al crear o eliminar muestra los datos básicos guardados", () => {
    const { details } = describeAuditEntry(
      { action: "delete", entity_type: "vacancy_requirements", entity_id: ID, metadata: { values: { description: "Excel avanzado", priority: "obligatorio" } } },
      empty,
    );
    expect(details).toContain("Datos: descripción: Excel avanzado · prioridad: Obligatorio");
  });
});
