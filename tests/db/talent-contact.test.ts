import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asActor,
  createApplication,
  createCandidate,
  createTestDatabase,
  createUser,
  createVacancy,
  expectError,
  user,
} from "./harness";

/**
 * Historial de contacto de la base de talentos (talent_invitations y
 * record_talent_invitations), reactivación en lote (add_candidates_to_vacancy)
 * y auditoría legible de etiquetas.
 */
let db: PGlite;
let rrhh: string;
let caleta: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH");
  caleta = await createUser(db, "reclutador_caleta", "Caleta");
});

afterAll(async () => {
  await db.close();
});

type AuditRow = { action: string; entity_type: string; entity_id: string; actor_id: string | null; metadata: Record<string, unknown> };

async function auditFor(where: string, params: unknown[]) {
  const { rows } = await db.query<AuditRow>(
    `select action, entity_type, entity_id, actor_id, metadata from public.audit_logs where ${where} order by id`,
    params,
  );
  return rows;
}

const recordInvitations = (actor: string, vacancyId: string, items: unknown[], alreadyInvited = 0) =>
  asActor(db, user(actor), () =>
    db.query<{ record_talent_invitations: string }>("select public.record_talent_invitations($1, $2, $3)", [
      vacancyId,
      JSON.stringify(items),
      alreadyInvited,
    ]),
  );

describe("record_talent_invitations", () => {
  it("registra cada invitación con quién la envió y deja una línea por invitación y otra de resumen", async () => {
    const vacancy = await createVacancy(db, { title: "Desarrollador" });
    const sent = await createCandidate(db, "Con correo");
    const revoked = await createCandidate(db, "Revocó");

    const { rows } = await recordInvitations(
      rrhh,
      vacancy,
      [
        { candidate_id: sent, outcome: "enviada" },
        { candidate_id: revoked, outcome: "consentimiento_revocado" },
      ],
      2,
    );
    const batchId = rows[0]!.record_talent_invitations;

    const invitations = await db.query<{ candidate_id: string; outcome: string; sent_by: string }>(
      "select candidate_id, outcome, sent_by from public.talent_invitations where batch_id = $1 order by outcome",
      [batchId],
    );
    expect(invitations.rows).toEqual([
      { candidate_id: sent, outcome: "enviada", sent_by: rrhh },
      { candidate_id: revoked, outcome: "consentimiento_revocado", sent_by: rrhh },
    ]);

    const perInvitation = await auditFor("action = 'invitacion_cartera' and metadata->>'batch_id' = $1", [batchId]);
    expect(perInvitation).toHaveLength(2);
    expect(perInvitation[0]).toMatchObject({
      entity_type: "talent_invitations",
      actor_id: rrhh,
      metadata: { candidate_id: sent, vacancy_id: vacancy, outcome: "enviada" },
    });

    const summary = await auditFor("action = 'invitacion_cartera_lote' and entity_id = $1", [batchId]);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({
      entity_type: "talent_pool",
      metadata: { vacancy_id: vacancy, total: 2, enviada: 1, consentimiento_revocado: 1, sin_correo: 0, error: 0, already_invited: 2 },
    });
  });

  it("no guarda nombres ni correos de candidatos en la auditoría", async () => {
    const vacancy = await createVacancy(db, { title: "Privacidad" });
    const candidate = await createCandidate(db, "Nombre Que No Debe Salir");
    await recordInvitations(rrhh, vacancy, [{ candidate_id: candidate, outcome: "enviada" }]);
    const rows = await auditFor("metadata->>'candidate_id' = $1", [candidate]);
    expect(JSON.stringify(rows)).not.toMatch(/Nombre Que No Debe Salir|@/);
  });

  it("el personal lee el historial; un usuario sin rol de RRHH no ve nada", async () => {
    const vacancy = await createVacancy(db, { title: "Lectura" });
    const candidate = await createCandidate(db, "Leído");
    await recordInvitations(rrhh, vacancy, [{ candidate_id: candidate, outcome: "enviada" }]);

    const asStaff = await asActor(db, user(rrhh), () =>
      db.query("select id from public.talent_invitations where candidate_id = $1", [candidate]),
    );
    expect(asStaff.rows).toHaveLength(1);

    const asCaleta = await asActor(db, user(caleta), () =>
      db.query("select id from public.talent_invitations where candidate_id = $1", [candidate]),
    );
    expect(asCaleta.rows).toHaveLength(0);
  });

  it("nadie escribe el historial directamente: solo por la función", async () => {
    const vacancy = await createVacancy(db, { title: "Directo" });
    const candidate = await createCandidate(db, "Directo");
    const error = await expectError(
      asActor(db, user(rrhh), () =>
        db.query(
          "insert into public.talent_invitations (candidate_id, vacancy_id, batch_id, outcome) values ($1, $2, gen_random_uuid(), 'enviada')",
          [candidate, vacancy],
        ),
      ),
    );
    expect(error.message).toMatch(/permission denied|permiso/i);
  });

  it("solo el personal puede registrar invitaciones y el lote no puede ir vacío", async () => {
    const vacancy = await createVacancy(db, { title: "Permisos" });
    const candidate = await createCandidate(db, "Permisos");
    const denied = await expectError(recordInvitations(caleta, vacancy, [{ candidate_id: candidate, outcome: "enviada" }]));
    expect(denied.message).toMatch(/No autorizado/);
    const empty = await expectError(recordInvitations(rrhh, vacancy, []));
    expect(empty.message).toMatch(/entre 1 y 100/);
  });
});

describe("add_candidates_to_vacancy", () => {
  const addBatch = (vacancyId: string, candidateIds: string[]) =>
    asActor(db, user(rrhh), () =>
      db.query<{ add_candidates_to_vacancy: { batch_id: string; added: string[]; failed: { candidate_id: string; reason: string }[] } }>(
        "select public.add_candidates_to_vacancy($1, $2)",
        [vacancyId, candidateIds],
      ),
    );

  it("añade a los disponibles, informa los que no se pudieron con su motivo y deja un resumen", async () => {
    const target = await createVacancy(db, { title: "Destino" });
    const other = await createVacancy(db, { title: "Proceso activo" });
    const free = await createCandidate(db, "Libre");
    const busy = await createCandidate(db, "Ocupado");
    await createApplication(db, busy, other); // sigue en proceso en otra vacante

    const { rows } = await addBatch(target, [free, busy]);
    const result = rows[0]!.add_candidates_to_vacancy;
    expect(result.added).toEqual([free]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ candidate_id: busy });
    expect(result.failed[0]!.reason).toMatch(/ya está en proceso/i);

    const created = await db.query<{ intake_method: string; created_by: string }>(
      "select intake_method, created_by from public.applications where candidate_id = $1 and vacancy_id = $2",
      [free, target],
    );
    expect(created.rows[0]).toEqual({ intake_method: "cartera", created_by: rrhh });

    const summary = await auditFor("action = 'reactivacion_cartera_lote' and entity_id = $1", [result.batch_id]);
    expect(summary[0]).toMatchObject({
      entity_type: "talent_pool",
      actor_id: rrhh,
      metadata: { vacancy_id: target, added: 1, failed: 1, candidate_ids: [free], failed_ids: [busy] },
    });
  });

  it("un usuario sin rol de RRHH no puede reactivar en lote", async () => {
    const target = await createVacancy(db, { title: "Sin permiso" });
    const candidate = await createCandidate(db, "Sin permiso");
    const error = await expectError(
      asActor(db, user(caleta), () => db.query("select public.add_candidates_to_vacancy($1, $2)", [target, [candidate]])),
    );
    expect(error.message).toMatch(/No autorizado/);
  });
});

describe("auditoría de etiquetas", () => {
  it("registra el nombre de la etiqueta al crearla, asignarla y quitarla", async () => {
    const candidate = await createCandidate(db, "Etiquetado");
    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ id: string }>("insert into public.talent_tags (name, color, created_by) values ('Finalista 2026', 'orange', $1) returning id", [
        rrhh,
      ]),
    );
    const tagId = rows[0]!.id;
    await asActor(db, user(rrhh), async () => {
      await db.query("insert into public.candidate_tags (candidate_id, tag_id, assigned_by) values ($1, $2, $3)", [candidate, tagId, rrhh]);
      await db.query("delete from public.candidate_tags where candidate_id = $1 and tag_id = $2", [candidate, tagId]);
    });

    const created = await auditFor("entity_type = 'talent_tags' and entity_id = $1", [tagId]);
    expect(created).toEqual([
      expect.objectContaining({ action: "etiqueta_creada", actor_id: rrhh, metadata: { tag: "Finalista 2026", color: "orange" } }),
    ]);

    const assignments = await auditFor("entity_type = 'candidate_tags' and metadata->>'candidate_id' = $1", [candidate]);
    expect(assignments.map((row) => row.action)).toEqual(["etiqueta_asignada", "etiqueta_quitada"]);
    expect(assignments[0]!.metadata).toMatchObject({ candidate_id: candidate, tag_id: tagId, tag: "Finalista 2026" });
  });

  it("al renombrar guarda el nombre anterior y el nuevo", async () => {
    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ id: string }>("insert into public.talent_tags (name, created_by) values ('Recontratar', $1) returning id", [rrhh]),
    );
    const tagId = rows[0]!.id;
    await asActor(db, user(rrhh), () => db.query("update public.talent_tags set name = 'Volver a llamar' where id = $1", [tagId]));
    const updated = await auditFor("entity_type = 'talent_tags' and entity_id = $1 and action = 'etiqueta_modificada'", [tagId]);
    expect(updated[0]!.metadata).toMatchObject({
      tag: "Volver a llamar",
      changes: { name: { from: "Recontratar", to: "Volver a llamar" } },
    });
  });
});
