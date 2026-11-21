import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addRequirement,
  anon,
  approveCriteria,
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
 * Autoagenda (docs/superpowers/specs/2026-11-20-talento-y-autoagenda-design.md):
 * RRHH ofrece horarios, la persona elige uno por un enlace (token; la base solo
 * guarda su hash) y la entrevista se crea sola. Un horario está «tomado» si
 * quien invitó ya tiene otra entrevista programada que se superpone.
 */
let db: PGlite;
let rrhh: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
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

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function application() {
  const vacancyId = await createVacancy(db);
  await addRequirement(db, vacancyId, { description: "Gestión de planillas", weight: 5 });
  await approveCriteria(db, vacancyId);
  const candidateId = await createCandidate(db, "Persona Ficticia Agenda");
  return createApplication(db, candidateId, vacancyId);
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

async function offer(applicationId: string, slots: string[], opts: { expiresAt?: string; hash?: string } = {}) {
  const hash = opts.hash ?? newToken().hash;
  const id = await asActor(db, user(rrhh), () =>
    db.query<{ id: string }>(
      `select public.create_interview_booking($1, $2::timestamptz[], 45, 'virtual', 'https://meet.example/abc', 'Ana Ficticia', null,
         array['ana.entrevista@ejemplo.test'], $3::timestamptz, $4) as id`,
      [applicationId, slots, opts.expiresAt ?? hoursFromNow(1.5), hash],
    ),
  ).then((r) => r.rows[0]!.id);
  return { id, hash };
}

const view = (hash: string) =>
  asService(() => db.query<{ b: { status: string; slots: { id: string; starts_at: string }[] } | null }>("select public.get_interview_booking($1) as b", [hash])).then(
    (r) => r.rows[0]!.b,
  );

const book = (hash: string, slotId: string) =>
  asService(() => db.query<{ id: string }>("select public.book_interview_slot($1, $2) as id", [hash, slotId])).then((r) => r.rows[0]!.id);

const offerRow = async (id: string) =>
  (await db.query<{ status: string; interview_id: string | null }>("select status, interview_id from public.interview_booking_offers where id = $1", [id])).rows[0]!;

describe("crear la invitación", () => {
  it("crea una invitación válida con sus horarios", async () => {
    const app = await application();
    const { id, hash } = await offer(app, [hoursFromNow(3), hoursFromNow(5)]);
    expect((await offerRow(id)).status).toBe("pendiente");
    const b = await view(hash);
    expect(b!.status).toBe("pendiente");
    expect(b!.slots).toHaveLength(2);
  });

  it("rechaza 0 o 7 horarios, horarios pasados o muy próximos, el plazo después del último horario y una segunda pendiente", async () => {
    const app = await application();
    await expectError(offer(app, []));
    await expectError(offer(app, Array.from({ length: 7 }, (_, i) => hoursFromNow(3 + i))));
    await expectError(offer(app, [hoursFromNow(0.5)]));
    await expectError(offer(app, [hoursFromNow(3)], { expiresAt: hoursFromNow(4) }));
    await offer(app, [hoursFromNow(3)]);
    const error = await expectError(offer(app, [hoursFromNow(6)]));
    expect(error.message).toMatch(/pendiente/i);
  });

  it("rechaza una postulación cerrada", async () => {
    const app = await application();
    await asActor(db, user(rrhh), () =>
      db.query("select public.change_application_status($1, 'no_seleccionado', 'Perfil no compatible', null)", [app]),
    );
    await expectError(offer(app, [hoursFromNow(3)]));
  });

  it("anon no puede crear y el personal no puede usar las funciones de servicio", async () => {
    const app = await application();
    const { hash } = newToken();
    await expectError(
      asActor(db, anon, () =>
        db.query(
          "select public.create_interview_booking($1, $2::timestamptz[], 45, 'virtual', null, null, null, null, $3::timestamptz, $4)",
          [app, [hoursFromNow(3)], hoursFromNow(1.5), hash],
        ),
      ),
    );
    await expectError(asActor(db, user(rrhh), () => db.query("select public.get_interview_booking($1)", [hash])));
    await expectError(asActor(db, user(rrhh), () => db.query("select public.book_interview_slot($1, $2)", [hash, crypto.randomUUID()])));
    await expectError(asActor(db, user(rrhh), () => db.query("select public.expire_interview_bookings()")));
    await expectError(asActor(db, user(rrhh), () => db.query("select public.enqueue_system_interview_deep_dive($1)", [app])));
  });
});

describe("elegir horario", () => {
  it("agendar crea la entrevista programada, cambia el estado y deja como autor a quien invitó", async () => {
    const app = await application();
    const { id, hash } = await offer(app, [hoursFromNow(3), hoursFromNow(5)]);
    const slot = (await view(hash))!.slots[1]!;
    const interviewId = await book(hash, slot.id);
    const interview = (
      await db.query<{ status: string; created_by: string; interviewer_emails: string[]; scheduled_at: Date }>(
        "select status, created_by, interviewer_emails, scheduled_at from public.interviews where id = $1",
        [interviewId],
      )
    ).rows[0]!;
    expect(interview).toMatchObject({ status: "programada", created_by: rrhh, interviewer_emails: ["ana.entrevista@ejemplo.test"] });
    expect(new Date(interview.scheduled_at).toISOString()).toBe(new Date(slot.starts_at).toISOString());
    const status = (await db.query<{ status: string }>("select status from public.applications where id = $1", [app])).rows[0]!.status;
    expect(status).toBe("entrevista_programada");
    expect(await offerRow(id)).toMatchObject({ status: "agendada", interview_id: interviewId });
    expect((await view(hash))!.status).toBe("agendada");
  });

  it("un horario tomado por otra entrevista de quien invitó ya no se ofrece ni se puede elegir", async () => {
    const at = hoursFromNow(8);
    const first = await offer(await application(), [at]);
    const second = await offer(await application(), [at, hoursFromNow(10)]);
    await book(first.hash, (await view(first.hash))!.slots[0]!.id);
    const remaining = (await view(second.hash))!.slots;
    expect(remaining).toHaveLength(1);
    const taken = (await db.query<{ id: string }>("select id from public.interview_booking_slots where offer_id = $1 and starts_at = $2", [second.id, at])).rows[0]!;
    const error = await expectError(book(second.hash, taken.id));
    expect(error.message).toMatch(/disponible/i);
  });

  it("no se puede elegir con la invitación vencida o cancelada, ni un horario de otra invitación", async () => {
    const a = await offer(await application(), [hoursFromNow(12)]);
    const b = await offer(await application(), [hoursFromNow(14)]);
    await expectError(book(a.hash, (await view(b.hash))!.slots[0]!.id));

    await db.query("update public.interview_booking_offers set expires_at = now() - interval '1 minute' where id = $1", [b.id]);
    await expectError(book(b.hash, (await db.query<{ id: string }>("select id from public.interview_booking_slots where offer_id = $1", [b.id])).rows[0]!.id));

    await asActor(db, user(rrhh), () => db.query("select public.cancel_interview_booking($1)", [a.id]));
    expect((await offerRow(a.id)).status).toBe("cancelada");
    expect((await view(a.hash))!.slots).toEqual([]);
    await expectError(book(a.hash, (await db.query<{ id: string }>("select id from public.interview_booking_slots where offer_id = $1", [a.id])).rows[0]!.id));
  });
});

describe("revisión final (20/11)", () => {
  it("volver a invitar después del plazo no espera a la tarea diaria", async () => {
    const app = await application();
    const first = await offer(app, [hoursFromNow(60)]);
    await db.query("update public.interview_booking_offers set expires_at = now() - interval '1 minute' where id = $1", [first.id]);
    const second = await offer(app, [hoursFromNow(70)]);
    expect((await offerRow(first.id)).status).toBe("vencida");
    expect((await offerRow(second.id)).status).toBe("pendiente");
  });

  it("cerrar la postulación cancela la invitación pendiente", async () => {
    const app = await application();
    const { id } = await offer(app, [hoursFromNow(80)]);
    await asActor(db, user(rrhh), () =>
      db.query("select public.change_application_status($1, 'no_seleccionado', 'Perfil no compatible', null)", [app]),
    );
    expect((await offerRow(id)).status).toBe("cancelada");
  });

  it("archivar la vacante cancela sus invitaciones pendientes", async () => {
    const app = await application();
    const { id } = await offer(app, [hoursFromNow(90)]);
    await db.query("update public.vacancies set status = 'archivada' where id = (select vacancy_id from public.applications where id = $1)", [app]);
    expect((await offerRow(id)).status).toBe("cancelada");
  });

  it("anonimizar borra las indicaciones y el lugar escritos en las invitaciones", async () => {
    const admin = await createUser(db, "admin", "Administración Ficticia");
    const app = await application();
    const { id } = await offer(app, [hoursFromNow(100)]);
    await db.query("update public.interview_booking_offers set instructions = 'Llamar a la persona al 999 888 777' where id = $1", [id]);
    await asActor(db, user(rrhh), () =>
      db.query("select public.change_application_status($1, 'no_seleccionado', 'Perfil no compatible', null)", [app]),
    );
    const candidate = (await db.query<{ candidate_id: string }>("select candidate_id from public.applications where id = $1", [app])).rows[0]!.candidate_id;
    await asActor(db, user(admin), () => db.query("select public.anonymize_candidate($1)", [candidate]));
    const row = (await db.query<{ instructions: string | null; location: string | null }>("select instructions, location from public.interview_booking_offers where id = $1", [id])).rows[0]!;
    expect(row).toEqual({ instructions: null, location: null });
  });
});

describe("límite de la página pública", () => {
  it("permite 30 intentos por hora y por origen, y solo lo usa el servicio", async () => {
    const subject = createHash("sha256").update("ip-de-prueba").digest("hex");
    const consume = () =>
      asService(() => db.query<{ ok: boolean }>("select public.consume_booking_rate_limit($1) as ok", [subject])).then((r) => r.rows[0]!.ok);
    for (let i = 0; i < 30; i++) expect(await consume()).toBe(true);
    expect(await consume()).toBe(false);
    await expectError(asActor(db, anon, () => db.query("select public.consume_booking_rate_limit($1)", [subject])));
  });
});

describe("enlace nuevo", () => {
  it("renovar el enlace deja sin efecto el anterior", async () => {
    const { id, hash } = await offer(await application(), [hoursFromNow(50)]);
    const fresh = newToken();
    await asActor(db, user(rrhh), () => db.query("select public.renew_interview_booking_link($1, $2)", [id, fresh.hash]));
    expect(await view(hash)).toBeNull();
    expect((await view(fresh.hash))!.slots).toHaveLength(1);
    await expectError(asActor(db, anon, () => db.query("select public.renew_interview_booking_link($1, $2)", [id, newToken().hash])));
  });

  it("no renueva una invitación cuyo plazo ya pasó (revisión 21/11)", async () => {
    const { id } = await offer(await application(), [hoursFromNow(52)]);
    await db.query("update public.interview_booking_offers set expires_at = now() - interval '1 minute' where id = $1", [id]);
    await expectError(asActor(db, user(rrhh), () => db.query("select public.renew_interview_booking_link($1, $2)", [id, newToken().hash])));
  });
});

describe("lugar de la entrevista en el enlace (revisión 21/11)", () => {
  const place = (hash: string) =>
    asService(() => db.query<{ location: string | null }>("select public.get_interview_booking($1) ->> 'location' as location", [hash])).then(
      (r) => r.rows[0]!.location,
    );

  it("se muestra mientras la invitación sigue viva y no cuando venció o se canceló", async () => {
    const live = await offer(await application(), [hoursFromNow(54)]);
    expect(await place(live.hash)).toBe("https://meet.example/abc");

    const expired = await offer(await application(), [hoursFromNow(56)]);
    await db.query("update public.interview_booking_offers set expires_at = now() - interval '1 minute' where id = $1", [expired.id]);
    expect(await place(expired.hash)).toBeNull();

    const cancelled = await offer(await application(), [hoursFromNow(58)]);
    await asActor(db, user(rrhh), () => db.query("select public.cancel_interview_booking($1)", [cancelled.id]));
    expect(await place(cancelled.hash)).toBeNull();
  });
});

describe("vencimiento y programación manual", () => {
  it("el vencimiento marca «vencida» y avisa en la campana a quien invitó", async () => {
    const app = await application();
    const { id } = await offer(app, [hoursFromNow(20)]);
    await db.query("update public.interview_booking_offers set expires_at = now() - interval '1 minute' where id = $1", [id]);
    const expired = await asService(() => db.query<{ n: number }>("select public.expire_interview_bookings() as n")).then((r) => r.rows[0]!.n);
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await offerRow(id)).status).toBe("vencida");
    const notes = await db.query("select 1 from public.notifications where recipient_id = $1 and application_id = $2 and kind = 'agenda_vencida'", [rrhh, app]);
    expect(notes.rows).toHaveLength(1);
  });

  it("programar la entrevista a mano cancela la invitación pendiente", async () => {
    const app = await application();
    const { id } = await offer(app, [hoursFromNow(30)]);
    await asActor(db, user(rrhh), () =>
      db.query("select public.schedule_interview($1, $2::timestamptz, 45, 'presencial', 'Oficina', null, null)", [app, hoursFromNow(40)]),
    );
    expect((await offerRow(id)).status).toBe("cancelada");
  });

  it("enqueue_system_interview_deep_dive lo usa solo el servicio (sin evaluación no encola)", async () => {
    const app = await application();
    const result = await asService(() => db.query<{ id: string | null }>("select public.enqueue_system_interview_deep_dive($1) as id", [app]));
    expect(result.rows[0]!.id).toBeNull();
  });
});
