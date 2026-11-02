import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createTestDatabase, createUser, createVacancy, expectError, user } from "./harness";

/**
 * Robot de portales: cola de publicación (RRHH solicita, el bot reclama y
 * reporta), retiro automático al cerrar la vacante y registro de postulantes
 * sin duplicados.
 */
let db: PGlite;
let rrhh: string;
let portalId: string;
let manualPortalId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  portalId = (await db.query<{ id: string }>("select id from public.job_portals where name = 'Trabajos Diarios'")).rows[0]!.id;
  manualPortalId = (await db.query<{ id: string }>("select id from public.job_portals where name = 'Bumeran'")).rows[0]!.id;
});

afterAll(async () => {
  await db?.close();
});

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const request = (vacancyId: string, portal = portalId) =>
  asActor(db, user(rrhh), () =>
    db.query<{ id: string }>("select public.request_portal_publication($1, $2) as id", [vacancyId, portal]),
  );

type Job = { publication_id: string; action: string; external_id: string | null; vacancy: Record<string, unknown> };

const claim = () =>
  asService(() => db.query<Job>("select * from public.bot_claim_publication($1)", [portalId]));

/** Reclama trabajos hasta encontrar el de `id` (otras pruebas pueden haber dejado cola). */
async function claimJob(id: string): Promise<Job | undefined> {
  for (let i = 0; i < 50; i++) {
    const { rows } = await claim();
    if (rows.length === 0) return undefined;
    const found = rows.find((r) => r.publication_id === id);
    if (found) return found;
  }
  return undefined;
}

const report = (id: string, outcome: string, externalId: string | null = null, error: string | null = null) =>
  asService(() =>
    db.query("select public.bot_report_publication($1, $2, $3, $4, $5)", [
      id,
      outcome,
      externalId,
      externalId ? `https://portal.test/oferta/${externalId}` : null,
      error,
    ]),
  );

const statusOf = async (id: string) =>
  (await db.query<{ status: string }>("select status from public.portal_publications where id = $1", [id])).rows[0]!.status;

async function publishedOffer() {
  const vacancy = await createVacancy(db, { title: `Vacante ${randomUUID().slice(0, 6)}` });
  const publicationId = (await request(vacancy)).rows[0]!.id;
  await claimJob(publicationId);
  await report(publicationId, "publicada", `ext-${randomUUID().slice(0, 8)}`);
  return { vacancy, publicationId };
}

describe("catálogo y privilegios", () => {
  it("solo Trabajos Diarios admite al bot", async () => {
    const { rows } = await db.query<{ name: string }>("select name from public.job_portals where bot_enabled");
    expect(rows).toEqual([{ name: "Trabajos Diarios" }]);
  });

  it("anon y authenticated no ejecutan las funciones del bot; service_role sí", async () => {
    const { rows } = await db.query<{ proname: string; auth: boolean; service: boolean }>(
      `select p.proname,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('bot_claim_publication', 'bot_report_publication', 'bot_list_active_publications',
                           'bot_mark_synced', 'register_bot_application')`,
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row, row.proname).toMatchObject({ auth: false, service: true });
  });

  it("nadie escribe directamente en portal_publications", async () => {
    const vacancy = await createVacancy(db);
    const error = await expectError(
      asActor(db, user(rrhh), () =>
        db.query("insert into public.portal_publications (vacancy_id, portal_id) values ($1, $2)", [vacancy, portalId]),
      ),
    );
    expect(error.message).toMatch(/permission denied/i);
  });
});

describe("solicitud de publicación", () => {
  it("crea la fila pendiente y deja constancia en la auditoría", async () => {
    const vacancy = await createVacancy(db);
    const id = (await request(vacancy)).rows[0]!.id;
    expect(await statusOf(id)).toBe("pendiente");
    const { rows } = await db.query(
      "select 1 from public.audit_logs where action = 'publicacion_portal_solicitada' and entity_id = $1",
      [id],
    );
    expect(rows).toHaveLength(1);
  });

  it("rechaza una solicitud repetida, un portal sin bot y una vacante no publicada", async () => {
    const vacancy = await createVacancy(db);
    await request(vacancy);
    await expectError(request(vacancy));
    await expectError(request(vacancy, manualPortalId));
    const draft = await createVacancy(db, { status: "borrador" });
    await expectError(request(draft));
  });

  it("exige personal autenticado", async () => {
    const vacancy = await createVacancy(db);
    await expectError(db.query("select public.request_portal_publication($1, $2)", [vacancy, portalId]));
  });
});

describe("cola del bot", () => {
  it("entrega los datos de la vacante, la reserva y no la entrega dos veces", async () => {
    const vacancy = await createVacancy(db, { title: "Operario de almacén" });
    const id = (await request(vacancy)).rows[0]!.id;
    const job = await claimJob(id);
    expect(job).toMatchObject({ action: "publicar", external_id: null });
    expect(job!.vacancy).toMatchObject({ id: vacancy, title: "Operario de almacén", requirements: [] });
    expect(await statusOf(id)).toBe("publicando");
    expect(await claimJob(id)).toBeUndefined();
  });

  it("una publicación exitosa guarda el enlace y pasa a publicada", async () => {
    const { publicationId } = await publishedOffer();
    const { rows } = await db.query<{ status: string; external_url: string; published_at: string }>(
      "select status, external_url, published_at from public.portal_publications where id = $1",
      [publicationId],
    );
    expect(rows[0]).toMatchObject({ status: "publicada" });
    expect(rows[0]!.external_url).toMatch(/^https:\/\/portal\.test\/oferta\//);
    expect(rows[0]!.published_at).not.toBeNull();
  });

  it("un error queda visible y RRHH puede volver a solicitarla", async () => {
    const vacancy = await createVacancy(db);
    const id = (await request(vacancy)).rows[0]!.id;
    await claimJob(id);
    await report(id, "error", null, "sesion_expirada");
    expect(await statusOf(id)).toBe("error");
    expect((await request(vacancy)).rows[0]!.id).toBe(id);
    expect(await statusOf(id)).toBe("pendiente");
  });

  it("no acepta resultados fuera de secuencia ni códigos de error libres", async () => {
    const vacancy = await createVacancy(db);
    const id = (await request(vacancy)).rows[0]!.id;
    await expectError(report(id, "publicada", "ext-1")); // aún no se reclamó
    await claimJob(id);
    await expectError(report(id, "error", null, "Texto libre con datos personales"));
  });
});

describe("retiro", () => {
  it("cerrar la vacante retira la oferta publicada y el bot la recibe como retirar", async () => {
    const { vacancy, publicationId } = await publishedOffer();
    await db.query("update public.vacancies set status = 'cerrada' where id = $1", [vacancy]);
    expect(await statusOf(publicationId)).toBe("retirar");
    const job = await claimJob(publicationId);
    expect(job).toMatchObject({ action: "retirar" });
    await report(publicationId, "retirada");
    expect(await statusOf(publicationId)).toBe("retirada");
  });

  it("cerrar una vacante con publicación pendiente la cancela sin tocar el portal", async () => {
    const vacancy = await createVacancy(db);
    const id = (await request(vacancy)).rows[0]!.id;
    await db.query("update public.vacancies set status = 'archivada' where id = $1", [vacancy]);
    expect(await statusOf(id)).toBe("retirada");
  });

  it("RRHH puede retirar una oferta publicada", async () => {
    const { publicationId } = await publishedOffer();
    await asActor(db, user(rrhh), () => db.query("select public.request_portal_withdrawal($1)", [publicationId]));
    expect(await statusOf(publicationId)).toBe("retirar");
  });
});

const withdrawal = (publicationId: string) =>
  asActor(db, user(rrhh), () => db.query("select public.request_portal_withdrawal($1)", [publicationId]));

/** Deja la publicación reclamable otra vez (como si hubieran pasado los 30 minutos de reserva). */
const expireClaim = (id: string) =>
  db.query("update public.portal_publications set claimed_at = now() - interval '31 minutes' where id = $1", [id]);

describe("correcciones de la cola (revisión 2026-10-30)", () => {
  it("cerrar la vacante mientras el robot la publica no falla y deja la oferta por retirar", async () => {
    const vacancy = await createVacancy(db);
    const id = (await request(vacancy)).rows[0]!.id;
    await claimJob(id);
    expect(await statusOf(id)).toBe("publicando");

    await db.query("update public.vacancies set status = 'cerrada' where id = $1", [vacancy]);
    const { rows } = await db.query<{ status: string; external_id: string | null }>(
      "select status, external_id from public.portal_publications where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ status: "retirar", external_id: null });
  });

  it("si el robot informa que publicó cuando la vacante ya se cerró, guarda el id y la oferta se retira", async () => {
    const vacancy = await createVacancy(db);
    const id = (await request(vacancy)).rows[0]!.id;
    await claimJob(id);
    await db.query("update public.vacancies set status = 'cerrada' where id = $1", [vacancy]);

    await report(id, "publicada", "ext-tarde");
    const { rows } = await db.query<{ status: string; external_id: string | null }>(
      "select status, external_id from public.portal_publications where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ status: "retirar", external_id: "ext-tarde" });

    expect(await claimJob(id)).toMatchObject({ action: "retirar", external_id: "ext-tarde" });
    await report(id, "retirada");
    expect(await statusOf(id)).toBe("retirada");
  });

  it("un retiro que agota sus intentos pasa a error conservando el id, no bloquea la cola y RRHH puede reintentarlo", async () => {
    const { vacancy, publicationId } = await publishedOffer();
    await db.query("update public.vacancies set status = 'cerrada' where id = $1", [vacancy]);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await claimJob(publicationId)).toMatchObject({ action: "retirar" });
      await expireClaim(publicationId);
    }
    // Un trabajo posterior debe seguir saliendo aunque este ya agotó sus intentos.
    const laterVacancy = await createVacancy(db);
    const laterId = (await request(laterVacancy)).rows[0]!.id;
    expect(await claimJob(laterId)).toMatchObject({ action: "publicar" });

    const { rows } = await db.query<{ status: string; error_code: string; external_id: string | null }>(
      "select status, error_code, external_id from public.portal_publications where id = $1",
      [publicationId],
    );
    expect(rows[0]).toMatchObject({ status: "error", error_code: "retiro_fallido" });
    expect(rows[0]!.external_id).not.toBeNull();

    // Publicar de nuevo duplicaría la oferta viva; lo correcto es volver a pedir el retiro.
    await db.query("update public.vacancies set status = 'publicada' where id = $1", [vacancy]);
    await expectError(request(vacancy));
    await withdrawal(publicationId);
    expect(await statusOf(publicationId)).toBe("retirar");
  });

  it("un trabajo que agota sus intentos de publicación sigue pasando a error", async () => {
    const vacancy = await createVacancy(db);
    const id = (await request(vacancy)).rows[0]!.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      await claimJob(id);
      await expireClaim(id);
    }
    const later = (await request(await createVacancy(db))).rows[0]!.id;
    expect(await claimJob(later)).toBeDefined();
    const { rows } = await db.query<{ status: string; error_code: string }>(
      "select status, error_code from public.portal_publications where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ status: "error", error_code: "demasiados_intentos" });
  });

  it("marcar como sincronizada una publicación inexistente da RH404", async () => {
    const error = await expectError(
      asService(() => db.query("select public.bot_mark_synced($1)", [randomUUID()])),
    );
    expect(error).toMatchObject({ code: "RH404" });
  });
});

describe("postulantes traídos por el bot", () => {
  const sha = (seed: string = randomUUID()) => createHash("sha256").update(seed).digest("hex");

  function register(publicationId: string, externalId: string, overrides: { email?: string; sha?: string } = {}) {
    const candidateId = randomUUID();
    const resumeId = randomUUID();
    return asService(() =>
      db.query<{ application_id: string; already_registered: boolean }>(
        `select * from public.register_bot_application(
           $1, $2, $3::uuid, $4::uuid, $5, 'Lucía Ramos Ficticia', $6, null, 'cv.pdf', 'application/pdf', 1000, $7,
           'completada', 'pdf_text', 'extractor-v1', 'Texto ficticio del CV con experiencia en SQL.', '{}'::jsonb, '{}', null)`,
        [
          publicationId,
          externalId,
          candidateId,
          resumeId,
          `candidates/${candidateId}/${resumeId}.pdf`,
          overrides.email ?? `${randomUUID().slice(0, 8)}@correo.test`,
          overrides.sha ?? sha(),
        ],
      ),
    );
  }

  it("registra la postulación con el portal de origen y es idempotente por id externo", async () => {
    const { vacancy, publicationId } = await publishedOffer();
    const first = (await register(publicationId, "cand-1")).rows[0]!;
    expect(first.already_registered).toBe(false);
    const { rows } = await db.query<{ vacancy_id: string; portal_id: string; intake_method: string }>(
      "select vacancy_id, portal_id, intake_method from public.applications where id = $1",
      [first.application_id],
    );
    expect(rows[0]).toEqual({ vacancy_id: vacancy, portal_id: portalId, intake_method: "integracion" });

    const second = (await register(publicationId, "cand-1")).rows[0]!;
    expect(second).toEqual({ application_id: first.application_id, already_registered: true });
    const { rows: apps } = await db.query("select 1 from public.applications where vacancy_id = $1", [vacancy]);
    expect(apps).toHaveLength(1);
  });

  it("el mismo id externo en otra oferta es otra persona", async () => {
    const a = await publishedOffer();
    const b = await publishedOffer();
    const first = (await register(a.publicationId, "cand-x")).rows[0]!;
    const second = (await register(b.publicationId, "cand-x")).rows[0]!;
    expect(second.already_registered).toBe(false);
    expect(second.application_id).not.toBe(first.application_id);
  });

  it("marca posibles duplicados por correo sin fusionar fichas", async () => {
    const { publicationId } = await publishedOffer();
    await register(publicationId, "dup-1", { email: "repetido@correo.test" });
    const other = await publishedOffer();
    const second = (await register(other.publicationId, "dup-2", { email: "repetido@correo.test" })).rows[0]!;
    const { rows } = await db.query<{ possible_duplicate_reasons: string[] }>(
      "select possible_duplicate_reasons from public.applications where id = $1",
      [second.application_id],
    );
    expect(rows[0]!.possible_duplicate_reasons).toContain("correo");
  });

  it("rechaza publicaciones no activas y ids externos inválidos", async () => {
    const vacancy = await createVacancy(db);
    const pending = (await request(vacancy)).rows[0]!.id;
    await expectError(register(pending, "cand-z"));
    const { publicationId } = await publishedOffer();
    await expectError(register(publicationId, ""));
  });

  it("la oferta activa aparece en la lista del bot y se marca como sincronizada", async () => {
    const { publicationId } = await publishedOffer();
    type Row = { publication_id: string; last_synced_at: string | null };
    const list = () =>
      asService(() => db.query<Row>("select * from public.bot_list_active_publications($1)", [portalId]));
    expect((await list()).rows.find((r) => r.publication_id === publicationId)?.last_synced_at).toBeNull();
    await asService(() => db.query("select public.bot_mark_synced($1)", [publicationId]));
    expect((await list()).rows.find((r) => r.publication_id === publicationId)?.last_synced_at).not.toBeNull();
  });
});
