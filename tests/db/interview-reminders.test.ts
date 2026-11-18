import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  anon,
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
 * Recordatorios automáticos de entrevista (claim_due_interview_reminders y
 * finish_interview_reminder) y correos de los entrevistadores
 * (set_interview_interviewer_emails).
 */
let db: PGlite;
let rrhh: string;
let caleta: string;
let vacancyId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH");
  caleta = await createUser(db, "reclutador_caleta", "Caleta");
  vacancyId = await createVacancy(db);
});

afterAll(async () => {
  await db.close();
});

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

type Claimed = { interview_id: string; scheduled_at: string; recipient: string };

const claim = () =>
  asService(() => db.query<Claimed>("select * from public.claim_due_interview_reminders(24, 12)")).then((r) => r.rows);

const finish = (interviewId: string, scheduledAt: string, recipient: string, outcome: string) =>
  asService(() =>
    db.query("select public.finish_interview_reminder($1, $2, $3, $4)", [interviewId, scheduledAt, recipient, outcome]),
  );

/** Agenda como RRHH una entrevista dentro de `hoursAhead` horas. */
async function schedule(hoursAhead: number): Promise<string> {
  const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
  const { rows } = await asActor(db, user(rrhh), () =>
    db.query<{ id: string }>(
      "select public.schedule_interview($1, now() + make_interval(hours => $2), 45, 'virtual', 'https://meet.example/x') as id",
      [applicationId, hoursAhead],
    ),
  );
  return rows[0]!.id;
}

/** Simula que la entrevista se agendó (o modificó) hace `hours` horas, sin disparadores. */
async function ageInterview(interviewId: string, hours: number) {
  await db.exec("set session_replication_role = replica");
  try {
    await db.query("update public.interviews set updated_at = now() - make_interval(hours => $2) where id = $1", [
      interviewId,
      hours,
    ]);
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

const setEmails = (actor: string, interviewId: string, emails: string[]) =>
  asActor(db, user(actor), () =>
    db.query("select public.set_interview_interviewer_emails($1, $2::text[])", [interviewId, emails]),
  );

const ownClaims = (rows: Claimed[], interviewId: string) => rows.filter((row) => row.interview_id === interviewId);

beforeEach(async () => {
  // Cada prueba parte sin reservas pendientes de las anteriores.
  await db.exec("delete from public.interview_reminders");
});

describe("set_interview_interviewer_emails", () => {
  it("normaliza: minúsculas, sin espacios ni repetidos", async () => {
    const id = await schedule(30);
    await setEmails(rrhh, id, [" Jefa@Empresa.PE ", "jefa@empresa.pe", "", "otro@empresa.pe"]);
    const { rows } = await db.query<{ interviewer_emails: string[] }>(
      "select interviewer_emails from public.interviews where id = $1",
      [id],
    );
    expect([...rows[0]!.interviewer_emails].sort()).toEqual(["jefa@empresa.pe", "otro@empresa.pe"]);
  });

  it("rechaza correos no válidos y más de 10", async () => {
    const id = await schedule(30);
    const invalid = await expectError(setEmails(rrhh, id, ["no-es-correo"]));
    expect(invalid.message).toMatch(/no válido/);
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@empresa.pe`);
    const tooMany = await expectError(setEmails(rrhh, id, many));
    expect(tooMany.message).toMatch(/hasta 10/);
  });

  it("solo el personal con acceso y solo en entrevistas programadas", async () => {
    const id = await schedule(30);
    await expectError(setEmails(caleta, id, ["a@empresa.pe"]));
    await asActor(db, user(rrhh), () => db.query("select public.cancel_interview($1, 'Ya no se requiere')", [id]));
    const closed = await expectError(setEmails(rrhh, id, ["a@empresa.pe"]));
    expect(closed.message).toMatch(/programada/);
  });
});

describe("claim_due_interview_reminders", () => {
  it("reserva el recordatorio de la persona candidata y de cada entrevistador, una sola vez", async () => {
    const id = await schedule(20);
    await setEmails(rrhh, id, ["jefa@empresa.pe", "otro@empresa.pe"]);
    await ageInterview(id, 13);

    const first = ownClaims(await claim(), id);
    expect(first.map((row) => row.recipient).sort()).toEqual(["candidato", "jefa@empresa.pe", "otro@empresa.pe"]);
    const { rows: stored } = await db.query<{ outcome: string }>(
      "select outcome from public.interview_reminders where interview_id = $1",
      [id],
    );
    expect(stored.map((row) => row.outcome)).toEqual(["enviando", "enviando", "enviando"]);

    expect(ownClaims(await claim(), id)).toEqual([]);
  });

  it("no reserva lo agendado hace poco, lo que está fuera de la ventana ni lo cancelado", async () => {
    const recent = await schedule(20);
    await ageInterview(recent, 2);
    const far = await schedule(40);
    await ageInterview(far, 13);
    const cancelled = await schedule(20);
    await asActor(db, user(rrhh), () => db.query("select public.cancel_interview($1, 'Ya no se requiere')", [cancelled]));
    await ageInterview(cancelled, 13);

    const claimed = await claim();
    for (const id of [recent, far, cancelled]) expect(ownClaims(claimed, id)).toEqual([]);
  });

  it("guarda el resultado; un error libera la reserva para reintentar", async () => {
    const id = await schedule(20);
    await setEmails(rrhh, id, ["jefa@empresa.pe"]);
    await ageInterview(id, 13);
    const claimed = ownClaims(await claim(), id);
    const candidate = claimed.find((row) => row.recipient === "candidato")!;
    const interviewer = claimed.find((row) => row.recipient === "jefa@empresa.pe")!;

    await finish(id, candidate.scheduled_at, "candidato", "enviado");
    await finish(id, interviewer.scheduled_at, "jefa@empresa.pe", "error");

    const retry = ownClaims(await claim(), id);
    expect(retry.map((row) => row.recipient)).toEqual(["jefa@empresa.pe"]);
    const { rows } = await db.query<{ recipient: string; outcome: string }>(
      "select recipient, outcome from public.interview_reminders where interview_id = $1 order by recipient",
      [id],
    );
    expect(rows).toEqual([
      { recipient: "candidato", outcome: "enviado" },
      { recipient: "jefa@empresa.pe", outcome: "enviando" },
    ]);
  });

  it("libera reservas de una ejecución cortada (más de 30 min «enviando»)", async () => {
    const id = await schedule(20);
    await ageInterview(id, 13);
    expect(ownClaims(await claim(), id)).toHaveLength(1);
    await db.query("update public.interview_reminders set created_at = now() - interval '31 minutes' where interview_id = $1", [id]);
    expect(ownClaims(await claim(), id)).toHaveLength(1);
  });

  it("una entrevista reprogramada admite el recordatorio de la fecha nueva", async () => {
    const id = await schedule(20);
    await ageInterview(id, 13);
    const [first] = ownClaims(await claim(), id);
    await finish(id, first!.scheduled_at, "candidato", "enviado");

    await asActor(db, user(rrhh), () =>
      db.query("select public.reschedule_interview($1, now() + interval '22 hours', 45, 'virtual', 'https://meet.example/y')", [id]),
    );
    await ageInterview(id, 13);
    const again = ownClaims(await claim(), id);
    expect(again).toHaveLength(1);
    expect(again[0]!.scheduled_at).not.toBe(first!.scheduled_at);
  });

  it("solo la clave de servicio reserva y cierra; RRHH ve los recordatorios, anon no", async () => {
    const id = await schedule(20);
    await ageInterview(id, 13);
    await expectError(asActor(db, user(rrhh), () => db.query("select * from public.claim_due_interview_reminders()")));
    await expectError(
      asActor(db, user(rrhh), () =>
        db.query("select public.finish_interview_reminder($1, now(), 'candidato', 'enviado')", [id]),
      ),
    );
    await claim();
    const seen = await asActor(db, user(rrhh), () =>
      db.query("select recipient from public.interview_reminders where interview_id = $1", [id]),
    );
    expect(seen.rows).toHaveLength(1);
    await expectError(asActor(db, anon, () => db.query("select * from public.interview_reminders")));
    const caletaSees = await asActor(db, user(caleta), () => db.query("select * from public.interview_reminders"));
    expect(caletaSees.rows).toHaveLength(0);
  });

  it("valida los parámetros", async () => {
    const error = await expectError(asService(() => db.query("select * from public.claim_due_interview_reminders(0, 12)")));
    expect(error.message).toMatch(/ventana/);
    const outcome = await expectError(
      asService(() => db.query("select public.finish_interview_reminder(gen_random_uuid(), now(), 'candidato', 'x')")),
    );
    expect(outcome.message).toMatch(/no válido/);
  });
});
