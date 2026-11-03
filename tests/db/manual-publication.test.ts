import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asActor, createTestDatabase, createUser, createVacancy, expectError, user } from "./harness";

/**
 * Publicación a mano: RRHH registra una oferta publicada fuera del robot con su
 * código, la corrige o la retira, y el lector de correo la sigue encontrando
 * entre las publicaciones activas.
 */
let db: PGlite;
let rrhh: string;
let desactivada: string;
let bumeran: string; // manual, sin robot
let robotPortal: string; // Trabajos Diarios (admite al robot)
let inactivo: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticia");
  // Cuenta desactivada: conserva el JWT pero ya no es personal.
  desactivada = await createUser(db, "rrhh", "Persona Desactivada");
  await db.query("update public.profiles set is_active = false where id = $1", [desactivada]);
  const portal = async (name: string) =>
    (await db.query<{ id: string }>("select id from public.job_portals where name = $1", [name])).rows[0]!.id;
  bumeran = await portal("Bumeran");
  robotPortal = await portal("Trabajos Diarios");
  inactivo = await portal("Torre");
  await db.query("update public.job_portals set is_active = false where id = $1", [inactivo]);
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

const mark = (vacancy: string, portal: string, code: string, url: string | null = null, actor = rrhh) =>
  asActor(db, user(actor), () =>
    db.query<{ id: string }>("select public.mark_portal_published_manually($1, $2, $3, $4) as id", [vacancy, portal, code, url]),
  );

const withdraw = (id: string, actor = rrhh) =>
  asActor(db, user(actor), () => db.query("select public.mark_portal_withdrawn_manually($1)", [id]));

const rowOf = async (id: string) =>
  (
    await db.query<{ status: string; manual: boolean; external_id: string | null; external_url: string | null }>(
      "select status, manual, external_id, external_url from public.portal_publications where id = $1",
      [id],
    )
  ).rows[0]!;

describe("registrar una publicación a mano", () => {
  it("crea la publicación como publicada y manual, con el código recortado", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "  OFERTA-123  ", "https://bumeran.test/o/123")).rows[0]!.id;
    expect(await rowOf(id)).toEqual({
      status: "publicada",
      manual: true,
      external_id: "OFERTA-123",
      external_url: "https://bumeran.test/o/123",
    });
  });

  it("no exige que el portal admita al robot y trata el enlace vacío como ausente", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "SIN-ENLACE", "   ")).rows[0]!.id;
    expect((await rowOf(id)).external_url).toBeNull();
  });

  it("exige personal activo", async () => {
    const vacancy = await createVacancy(db);
    const error = await expectError(mark(vacancy, bumeran, "X1", null, desactivada));
    expect(error).toMatchObject({ code: "42501" });
  });

  it("rechaza una vacante inexistente (RH404) o no publicada (RH409)", async () => {
    expect(await expectError(mark(randomUUID(), bumeran, "X1"))).toMatchObject({ code: "RH404" });
    const borrador = await createVacancy(db, { status: "borrador" });
    expect(await expectError(mark(borrador, bumeran, "X1"))).toMatchObject({ code: "RH409" });
  });

  it("rechaza un portal inexistente o inactivo (RH404)", async () => {
    const vacancy = await createVacancy(db);
    expect(await expectError(mark(vacancy, randomUUID(), "X1"))).toMatchObject({ code: "RH404" });
    expect(await expectError(mark(vacancy, inactivo, "X1"))).toMatchObject({ code: "RH404" });
  });

  it("rechaza un código vacío o de más de 200 caracteres (RH422)", async () => {
    const vacancy = await createVacancy(db);
    expect(await expectError(mark(vacancy, bumeran, "   "))).toMatchObject({ code: "RH422" });
    expect(await expectError(mark(vacancy, bumeran, "x".repeat(201)))).toMatchObject({ code: "RH422" });
    const id = (await mark(vacancy, bumeran, "x".repeat(200))).rows[0]!.id;
    expect((await rowOf(id)).external_id).toHaveLength(200);
  });

  it("rechaza un enlace que no es https:// o pasa de 500 caracteres (RH422)", async () => {
    const vacancy = await createVacancy(db);
    expect(await expectError(mark(vacancy, bumeran, "X1", "http://bumeran.test/o/1"))).toMatchObject({ code: "RH422" });
    expect(await expectError(mark(vacancy, bumeran, "X1", `https://b.test/${"a".repeat(500)}`))).toMatchObject({ code: "RH422" });
  });

  it("repetirlo sobre una manual publicada corrige el código y el enlace", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "MAL-ESCRITO", "https://bumeran.test/o/1")).rows[0]!.id;
    const again = (await mark(vacancy, bumeran, "BIEN-ESCRITO")).rows[0]!.id;
    expect(again).toBe(id);
    expect(await rowOf(id)).toMatchObject({ status: "publicada", manual: true, external_id: "BIEN-ESCRITO", external_url: null });
  });

  it("no pisa una publicación del robot en cola ni una publicada por el robot (RH409)", async () => {
    const vacancy = await createVacancy(db);
    const pendiente = (
      await asActor(db, user(rrhh), () =>
        db.query<{ id: string }>("select public.request_portal_publication($1, $2) as id", [vacancy, robotPortal]),
      )
    ).rows[0]!.id;
    expect(await expectError(mark(vacancy, robotPortal, "X1"))).toMatchObject({ code: "RH409" });
    expect((await rowOf(pendiente)).status).toBe("pendiente");

    await db.query("update public.portal_publications set status = 'publicada', external_id = 'robot-1' where id = $1", [pendiente]);
    expect(await expectError(mark(vacancy, robotPortal, "X1"))).toMatchObject({ code: "RH409" });
    expect(await rowOf(pendiente)).toMatchObject({ manual: false, external_id: "robot-1" });
  });

  it("reutiliza una publicación retirada o con error, ahora como manual", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "PRIMERA")).rows[0]!.id;
    await withdraw(id);
    expect((await mark(vacancy, bumeran, "SEGUNDA")).rows[0]!.id).toBe(id);
    expect(await rowOf(id)).toMatchObject({ status: "publicada", manual: true, external_id: "SEGUNDA" });

    const other = await createVacancy(db);
    const errorId = (
      await asActor(db, user(rrhh), () =>
        db.query<{ id: string }>("select public.request_portal_publication($1, $2) as id", [other, robotPortal]),
      )
    ).rows[0]!.id;
    await db.query("update public.portal_publications set status = 'error', error_code = 'pagina_cambio' where id = $1", [errorId]);
    expect((await mark(other, robotPortal, "A-MANO")).rows[0]!.id).toBe(errorId);
    expect(await rowOf(errorId)).toMatchObject({ status: "publicada", manual: true, external_id: "A-MANO" });
  });

  it("la auditoría no guarda el código ni el enlace", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "CODIGO-SECRETO-77", "https://bumeran.test/secreto-77")).rows[0]!.id;
    const { rows } = await db.query<{ metadata: Record<string, unknown>; actor_id: string }>(
      "select metadata, actor_id from public.audit_logs where action = 'publicacion_portal_manual' and entity_id = $1",
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(rrhh);
    expect(rows[0]!.metadata).toEqual({ vacancy_id: vacancy, portal: "Bumeran" });
    expect(JSON.stringify(rows[0]!.metadata)).not.toMatch(/secreto|CODIGO/i);
  });
});

describe("retirar a mano", () => {
  it("pasa una manual publicada a retirada y deja auditoría", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "RETIRAR-1")).rows[0]!.id;
    await withdraw(id);
    expect((await rowOf(id)).status).toBe("retirada");
    const { rows } = await db.query(
      "select 1 from public.audit_logs where action = 'publicacion_portal_retiro_manual' and entity_id = $1",
      [id],
    );
    expect(rows).toHaveLength(1);
  });

  it("exige personal, que exista (RH404) y que sea manual y esté publicada (RH409)", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "RETIRAR-2")).rows[0]!.id;
    expect(await expectError(withdraw(id, desactivada))).toMatchObject({ code: "42501" });
    expect(await expectError(withdraw(randomUUID()))).toMatchObject({ code: "RH404" });

    await withdraw(id);
    expect(await expectError(withdraw(id))).toMatchObject({ code: "RH409" });

    const other = await createVacancy(db);
    const robotId = (
      await asActor(db, user(rrhh), () =>
        db.query<{ id: string }>("select public.request_portal_publication($1, $2) as id", [other, robotPortal]),
      )
    ).rows[0]!.id;
    await db.query("update public.portal_publications set status = 'publicada', external_id = 'r-1' where id = $1", [robotId]);
    expect(await expectError(withdraw(robotId))).toMatchObject({ code: "RH409" });
  });
});

describe("integración con el cierre de la vacante y el robot", () => {
  it("cerrar o archivar la vacante lleva la manual directo a retirada, sin pasar por el robot", async () => {
    for (const status of ["cerrada", "archivada"]) {
      const vacancy = await createVacancy(db);
      const manual = (await mark(vacancy, bumeran, `CIERRE-${status}`)).rows[0]!.id;
      const robot = (
        await asActor(db, user(rrhh), () =>
          db.query<{ id: string }>("select public.request_portal_publication($1, $2) as id", [vacancy, robotPortal]),
        )
      ).rows[0]!.id;
      await db.query("update public.portal_publications set status = 'publicada', external_id = 'r-2' where id = $1", [robot]);

      await db.query("update public.vacancies set status = $2::public.vacancy_status where id = $1", [vacancy, status]);
      expect((await rowOf(manual)).status, status).toBe("retirada");
      expect((await rowOf(robot)).status, status).toBe("retirar");
    }
  });

  it("el robot no reclama una publicación manual, pero el listado de activas la incluye marcada como manual", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, robotPortal, "TD-MANUAL-1")).rows[0]!.id;

    const claimed = await asService(() => db.query<{ publication_id: string }>("select * from public.bot_claim_publication($1)", [robotPortal]));
    expect(claimed.rows.map((r) => r.publication_id)).not.toContain(id);

    const active = await asService(() =>
      db.query<{ publication_id: string; manual: boolean }>("select * from public.bot_list_active_publications($1)", [robotPortal]),
    );
    expect(active.rows.find((r) => r.publication_id === id)).toMatchObject({ manual: true });
  });

  it("register_bot_application acepta un postulante en una publicación manual", async () => {
    const vacancy = await createVacancy(db);
    const id = (await mark(vacancy, bumeran, "POSTULA-1")).rows[0]!.id;
    const candidateId = randomUUID();
    const resumeId = randomUUID();
    const { rows } = await asService(() =>
      db.query<{ application_id: string; already_registered: boolean }>(
        `select * from public.register_bot_application(
           $1, 'aviso-1', $2::uuid, $3::uuid, $4, 'Lucía Ramos Ficticia', $5, null, 'cv.pdf', 'application/pdf', 1000, $6,
           'completada', 'pdf_text', 'extractor-v1', 'Texto ficticio del CV con experiencia en SQL.', '{}'::jsonb, '{}', null)`,
        [
          id,
          candidateId,
          resumeId,
          `candidates/${candidateId}/${resumeId}.pdf`,
          `${randomUUID().slice(0, 8)}@correo.test`,
          createHash("sha256").update(randomUUID()).digest("hex"),
        ],
      ),
    );
    expect(rows[0]).toMatchObject({ already_registered: false });
    const app = await db.query<{ vacancy_id: string }>("select vacancy_id from public.applications where id = $1", [rows[0]!.application_id]);
    expect(app.rows[0]!.vacancy_id).toBe(vacancy);
  });

  it("las funciones de RRHH son para authenticated y no para anon", async () => {
    const { rows } = await db.query<{ proname: string; anon: boolean; auth: boolean; service: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('mark_portal_published_manually', 'mark_portal_withdrawn_manually')`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row, row.proname).toMatchObject({ anon: false, auth: true });
  });
});
