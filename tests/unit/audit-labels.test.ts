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
    expect(result.text).toBe("Cambió el estado de una postulación: En revisión → Por entrevistar");
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
    ).toBe("Modificó una vacante (título, descripción)");
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

describe("tablas del sistema", () => {
  it("redacta en pasiva y sin nombres de tablas ni de columnas", () => {
    const ai = { action: "update", entity_type: "ai_evaluation_jobs", entity_id: null, metadata: { changed_fields: ["claim_token", "claimed_at"] } };
    expect(describeAuditEntry(ai).text).toBe("Se actualizó una evaluación con IA");
    expect(describeAuditEntry({ ...ai, entity_type: "learned_equivalences" }).text).toBe("Se actualizó un sinónimo aprendido por el motor de evaluación");
  });

  it("el filtro «todos» es válido", () => {
    expect(auditParamsSchema.parse({ actor: "todos" }).actor).toBe("todos");
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
    ).toBe("Cambió el estado de la postulación de Ana Pérez: En revisión → Por entrevistar");
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

describe("describeAuditEntry de la base de talentos", () => {
  const VAC = "11111111-1111-4111-8111-111111111111";
  const CAND = "33333333-3333-4333-8333-333333333333";
  const CAND2 = "66666666-6666-4666-8666-666666666666";
  const APP = "44444444-4444-4444-8444-444444444444";
  const ctx = {
    vacancies: { [VAC]: { title: "Desarrollador Full Stack", code: null } },
    portals: {},
    candidates: { [CAND]: "Valeria Ríos", [CAND2]: "Andrés Paredes" },
    profiles: {},
    requirements: {},
    links: { [`applications:${APP}`]: { candidateId: CAND, vacancyId: VAC } },
  };

  it("la reactivación desde la base tiene frase propia y muestra el origen en español", () => {
    const result = describeAuditEntry(
      { action: "insert", entity_type: "applications", entity_id: APP, metadata: { values: { status: "nuevo", intake_method: "cartera" } } },
      ctx,
    );
    expect(result.text).toBe("Reactivó desde la base de talentos a Valeria Ríos en la vacante «Desarrollador Full Stack»");
    expect(result.details).toContain("Datos: estado: Nuevo · origen: Base de talentos");
    expect(
      describeAuditEntry({ action: "insert", entity_type: "applications", entity_id: APP, metadata: { values: { intake_method: "cartera" } } }).text,
    ).toBe("Reactivó a un candidato desde la base de talentos");
  });

  it("cada invitación dice a quién, para qué vacante y su resultado, y enlaza al candidato", () => {
    const meta = (outcome: string) => ({ candidate_id: CAND, vacancy_id: VAC, outcome });
    const entry = (outcome: string) => ({ action: "invitacion_cartera", entity_type: "talent_invitations", entity_id: ID, metadata: meta(outcome) });
    expect(describeAuditEntry(entry("enviada"), ctx).text).toBe(
      "Invitó por correo a Valeria Ríos a postular para la vacante «Desarrollador Full Stack»",
    );
    expect(describeAuditEntry(entry("consentimiento_revocado"), ctx).text).toBe(
      "No invitó a Valeria Ríos para la vacante «Desarrollador Full Stack» porque revocó su consentimiento",
    );
    expect(describeAuditEntry(entry("sin_correo")).text).toBe("No pudo invitar a un candidato de la base: no tiene correo");
    const sent = describeAuditEntry(entry("error"), ctx);
    expect(sent.details).toContain("Resultado: Falló el envío");
    expect(sent.href).toBe(`/candidatos/${CAND}`);
  });

  it("los lotes resumen cifras y nombran a los candidatos añadidos y fallidos", () => {
    const added = describeAuditEntry(
      {
        action: "reactivacion_cartera_lote",
        entity_type: "talent_pool",
        entity_id: ID,
        metadata: { vacancy_id: VAC, added: 1, failed: 1, candidate_ids: [CAND], failed_ids: [CAND2] },
      },
      ctx,
    );
    expect(added.text).toBe("Añadió 1 candidato de la base de talentos a la vacante «Desarrollador Full Stack»");
    expect(added.href).toBe(`/vacantes/${VAC}`);
    expect(added.details).toContain("Añadidos: 1 · No se pudieron: 1");
    expect(added.details).toContain("Candidatos añadidos: Valeria Ríos");
    expect(added.details).toContain("No se pudieron añadir: Andrés Paredes");

    const invited = describeAuditEntry(
      {
        action: "invitacion_cartera_lote",
        entity_type: "talent_pool",
        entity_id: ID,
        metadata: { vacancy_id: VAC, total: 4, enviada: 3, sin_correo: 1, consentimiento_revocado: 0, error: 0, already_invited: 2 },
      },
      ctx,
    );
    expect(invited.text).toBe("Invitó a candidatos de la base para la vacante «Desarrollador Full Stack»: 3 de 4 enviadas");
    expect(
      describeAuditEntry({ action: "invitacion_cartera_lote", entity_type: "talent_pool", entity_id: ID, metadata: { total: 2, error: 2 } }).text,
    ).toBe("Invitó a candidatos de la base: 0 de 2 enviadas");
    expect(invited.details).toContain("Enviadas: 3 · Sin correo: 1 · Consentimiento revocado: 0 · Con error: 0 · Ya invitados antes: 2");
  });

  it("las etiquetas se describen con su nombre", () => {
    expect(
      describeAuditEntry({ action: "etiqueta_creada", entity_type: "talent_tags", entity_id: ID, metadata: { tag: "Finalista", color: "orange" } }).text,
    ).toBe("Creó la etiqueta «Finalista» en la base de talentos");
    expect(
      describeAuditEntry(
        { action: "etiqueta_asignada", entity_type: "candidate_tags", entity_id: ID, metadata: { candidate_id: CAND, tag: "Finalista" } },
        ctx,
      ).text,
    ).toBe("Asignó la etiqueta «Finalista» a Valeria Ríos");
    const renamed = describeAuditEntry(
      {
        action: "etiqueta_modificada",
        entity_type: "talent_tags",
        entity_id: ID,
        metadata: { tag: "Volver a llamar", changes: { name: { from: "Recontratar", to: "Volver a llamar" }, color: { from: "orange", to: "red" } } },
      },
      ctx,
    );
    expect(renamed.text).toBe("Modificó la etiqueta «Volver a llamar»");
    expect(renamed.details).toContain("Nombre: Recontratar → Volver a llamar");
    expect(renamed.details).toContain("Color: naranja → rojo");
    // Registros antiguos (disparador genérico, sin datos) siguen siendo legibles.
    expect(describeAuditEntry({ action: "insert", entity_type: "talent_tags", entity_id: ID, metadata: {} }).text).toBe(
      "Creó una etiqueta de la base de talentos",
    );
    expect(describeAuditEntry({ action: "insert", entity_type: "candidate_tags", entity_id: ID, metadata: {} }).text).toBe(
      "Asignó una etiqueta a un candidato",
    );
  });

  it("el filtro acepta el grupo «talento»", () => {
    expect(auditParamsSchema.parse({ group: "talento" }).group).toBe("talento");
  });
});
