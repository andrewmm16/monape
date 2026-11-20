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
 * Preguntas para profundizar (docs/superpowers/specs/2026-11-20-preguntas-profundizar-design.md):
 * cola propia para que la IA escriba las preguntas de la entrevista. Encolado por
 * el personal, reserva por el worker (con cierre silencioso de lo que ya no va a
 * entrevista), registro de lo pedido y cierre, y borrado al anonimizar.
 */
let db: PGlite;
let rrhh: string;
let admin: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  admin = await createUser(db, "admin", "Administración Ficticia");
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

/** Vacante con dos requisitos aprobados y una postulación; con `evaluate`, una evaluación vigente. */
async function setup(evaluate = true) {
  const vacancyId = await createVacancy(db);
  const r1 = await addRequirement(db, vacancyId, { description: "Gestión de planillas", weight: 5 });
  const r2 = await addRequirement(db, vacancyId, { description: "Excel avanzado", weight: 3 });
  const criteria = await approveCriteria(db, vacancyId);
  const candidateId = await createCandidate(db, "Persona Ficticia Profundizar");
  const applicationId = await createApplication(db, candidateId, vacancyId);
  if (evaluate) await recordEvaluation(applicationId, criteria, [r1, r2]);
  return { vacancyId, r1, r2, criteria, candidateId, applicationId };
}

async function recordEvaluation(applicationId: string, criteria: number, requirements: string[]) {
  const items = requirements.map((id) => ({
    requirement_id: id,
    assessment: "acreditado",
    evidence: [{ quote: "Analista de planillas en Comercial Andina, 2019-2022" }],
    rationale: "El CV lo menciona.",
  }));
  return asActor(db, user(rrhh), () =>
    db.query<{ id: string }>(
      `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v16', 'v1', null, 100, 100, 100,
         'alta'::public.compatibility_level, 'Resumen', array[]::text[], null, $3::jsonb) as id`,
      [applicationId, criteria, JSON.stringify(items)],
    ),
  ).then((r) => r.rows[0]!.id);
}

const request = (applicationId: string, automatic = false) =>
  asActor(db, user(rrhh), () =>
    db.query<{ id: string | null }>("select public.request_interview_deep_dive($1, $2) as id", [applicationId, automatic]),
  ).then((r) => r.rows[0]!.id);

const setStatus = (applicationId: string, status: string, reason: string | null = null) =>
  asActor(db, user(rrhh), () =>
    db.query("select public.change_application_status($1, $2::public.application_status, $3, null)", [applicationId, status, reason]),
  );

type Claimed = { deep_dive_id: string; application_id: string; attempts: number; claim_token: string };
const tokens = new Map<string, string>();
const claim = () =>
  asService(() => db.query<Claimed>("select * from public.deep_dive_claim()")).then((r) => {
    const job = r.rows[0];
    if (job) tokens.set(job.deep_dive_id, job.claim_token);
    return job;
  });

/** Reserva hasta vaciar la cola disponible (otras pruebas pueden haber dejado trabajos). */
async function drain() {
  for (let i = 0; i < 100; i++) if (!(await claim())) return;
}

async function claimJob(id: string): Promise<Claimed | undefined> {
  for (let i = 0; i < 100; i++) {
    const job = await claim();
    if (!job) return undefined;
    if (job.deep_dive_id === id) return job;
  }
  return undefined;
}

const startJob = (id: string, requested: { requirement_id: string; kind: string }[], token = tokens.get(id) ?? null) =>
  asService(() =>
    db.query("select public.deep_dive_start($1, $2, null, null, 1, $3::jsonb)", [id, token, JSON.stringify(requested)]),
  );

const completeJob = (id: string, questions: unknown[], token = tokens.get(id) ?? null) =>
  asService(() =>
    db.query<{ saved: number }>("select public.deep_dive_complete($1, $2, $3::jsonb, 'claude-haiku-5-5', 'ia-preguntas-v1') as saved", [
      id,
      token,
      JSON.stringify(questions),
    ]),
  ).then((r) => r.rows[0]!.saved);

const release = (id: string, outcome: string, code: string | null = null, token = tokens.get(id) ?? null) =>
  asService(() =>
    db.query<{ status: string }>("select public.deep_dive_release($1, $2, $3, $4, null) as status", [id, token, outcome, code]),
  ).then((r) => r.rows[0]!.status);

const row = async (id: string) =>
  (
    await db.query<{
      status: string;
      origin: string;
      attempts: number;
      error_code: string | null;
      questions: { requirement_id: string; kind: string; question: string; listen_for: string }[];
      resume_id: string | null;
      criteria_version: number | null;
    }>("select * from public.interview_deep_dives where id = $1", [id])
  ).rows[0]!;

const makeAvailable = (id: string) =>
  db.query("update public.interview_deep_dives set available_at = now() - interval '1 second' where id = $1", [id]);

describe("encolado", () => {
  it("el personal pide preguntas y pedirlas otra vez devuelve el mismo trabajo abierto", async () => {
    const { applicationId } = await setup();
    const first = await request(applicationId);
    expect(first).toBeTruthy();
    expect(await request(applicationId)).toBe(first);
    expect((await row(first!)).origin).toBe("manual");
  });

  it("sin evaluación vigente: el automático devuelve null y el manual falla con RH409", async () => {
    const { applicationId } = await setup(false);
    expect(await request(applicationId, true)).toBeNull();
    const error = await expectError(request(applicationId));
    expect(error.message).toMatch(/evaluación/i);
  });

  it("el automático no se repite con el mismo CV y versión de criterios; el manual sí", async () => {
    const { applicationId, r1, criteria } = await setup();
    // Un automático solo se atiende si la postulación está en entrevista.
    await setStatus(applicationId, "entrevista_programada");
    await drain();
    const id = await request(applicationId, true);
    expect(await claimJob(id!)).toBeTruthy();
    await asService(() =>
      db.query("select public.deep_dive_start($1, $2, null, null, $3, $4::jsonb)", [
        id,
        tokens.get(id!),
        criteria,
        JSON.stringify([{ requirement_id: r1, kind: "profundizar" }]),
      ]),
    );
    expect(await completeJob(id!, [{ requirement_id: r1, kind: "profundizar", question: "¿Cómo?", listen_for: "Detalles." }])).toBe(1);
    expect(await request(applicationId, true)).toBeNull();
    const manual = await request(applicationId);
    expect(manual).toBeTruthy();
    expect(manual).not.toBe(id);
  });

  it("evaluación desactualizada (criterios cambiados): el automático no encola y el manual falla con RH409", async () => {
    const { applicationId, vacancyId } = await setup();
    await approveCriteria(db, vacancyId);
    expect(await request(applicationId, true)).toBeNull();
    const error = await expectError(request(applicationId));
    expect(error.message).toMatch(/desactualizada/i);
  });

  it("anon no puede pedir ni el personal usar el ciclo del worker", async () => {
    const { applicationId } = await setup();
    await expectError(asActor(db, anon, () => db.query("select public.request_interview_deep_dive($1)", [applicationId])));
    await expectError(asActor(db, user(rrhh), () => db.query("select * from public.deep_dive_claim()")));
    await expectError(
      asActor(db, user(rrhh), () =>
        db.query("select public.deep_dive_release($1, $2, 'error', null, null)", [crypto.randomUUID(), crypto.randomUUID()]),
      ),
    );
  });

  it("el personal ve los trabajos de sus postulaciones; anon no", async () => {
    const { applicationId } = await setup();
    const id = await request(applicationId);
    const seen = await asActor(db, user(rrhh), () => db.query("select id from public.interview_deep_dives where id = $1", [id]));
    expect(seen.rows).toHaveLength(1);
    await expectError(asActor(db, anon, () => db.query("select id from public.interview_deep_dives where id = $1", [id])));
  });
});

describe("reserva", () => {
  it("al reservar, un automático de una postulación fuera de entrevista se cierra con fuera_de_entrevista y se entrega el siguiente", async () => {
    await drain();
    const out = await setup();
    await setStatus(out.applicationId, "entrevista_programada");
    const outId = await request(out.applicationId, true);
    await setStatus(out.applicationId, "no_seleccionado", "Perfil no compatible");
    const inside = await setup();
    await setStatus(inside.applicationId, "entrevista_programada");
    const insideId = await request(inside.applicationId, true);

    const job = await claim();
    expect(job?.deep_dive_id).toBe(insideId);
    const closed = await row(outId!);
    expect(closed.status).toBe("error");
    expect(closed.error_code).toBe("fuera_de_entrevista");
  });

  it("los manuales se atienden antes que los automáticos", async () => {
    await drain();
    const auto = await setup();
    await setStatus(auto.applicationId, "entrevista_programada");
    const autoId = await request(auto.applicationId, true);
    const manual = await setup();
    const manualId = await request(manual.applicationId);
    expect((await claim())?.deep_dive_id).toBe(manualId);
    expect((await claim())?.deep_dive_id).toBe(autoId);
  });
});

describe("cierre", () => {
  it("complete guarda solo lo pedido: descarta ids o tipos no enviados y recorta textos", async () => {
    const { applicationId, r1, r2 } = await setup();
    await drain();
    const id = await request(applicationId);
    await claimJob(id!);
    await startJob(id!, [{ requirement_id: r1, kind: "profundizar" }]);
    const saved = await completeJob(id!, [
      { requirement_id: r1, kind: "profundizar", question: "x".repeat(400), listen_for: "Detalles concretos." },
      { requirement_id: r1, kind: "confirmar", question: "¿Otra?", listen_for: "" },
      { requirement_id: r2, kind: "profundizar", question: "¿No pedida?", listen_for: "" },
    ]);
    expect(saved).toBe(1);
    const stored = await row(id!);
    expect(stored.status).toBe("completado");
    expect(stored.questions).toHaveLength(1);
    expect(stored.questions[0]!.question.length).toBeLessThanOrEqual(300);
  });

  it("complete sin ninguna pregunta válida falla con RH422", async () => {
    const { applicationId, r1, r2 } = await setup();
    await drain();
    const id = await request(applicationId);
    await claimJob(id!);
    await startJob(id!, [{ requirement_id: r1, kind: "profundizar" }]);
    const error = await expectError(completeJob(id!, [{ requirement_id: r2, kind: "profundizar", question: "¿No pedida?", listen_for: "" }]));
    expect(error.message).toMatch(/pregunta/i);
    expect((await row(id!)).status).toBe("procesando");
  });

  it("release: reintentar, limite y error con las mismas reglas que ai_release_job", async () => {
    const { applicationId } = await setup();
    await drain();
    const id = await request(applicationId);
    await claimJob(id!);
    expect(await release(id!, "limite", "limite_plan")).toBe("pendiente");
    expect((await row(id!)).attempts).toBe(0);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await makeAvailable(id!);
      await claimJob(id!);
      const status = await release(id!, "reintentar", "respuesta_invalida");
      expect(status).toBe(attempt < 3 ? "pendiente" : "error");
    }
    const closed = await row(id!);
    expect(closed.status).toBe("error");
    expect(closed.error_code).toBe("respuesta_invalida");
  });

  it("quien perdió la reserva no puede liberar ni completar", async () => {
    const { applicationId, r1 } = await setup();
    await drain();
    const id = await request(applicationId);
    await claimJob(id!);
    await startJob(id!, [{ requirement_id: r1, kind: "profundizar" }]);
    const stale = crypto.randomUUID();
    await expectError(release(id!, "error", "x", stale));
    await expectError(completeJob(id!, [{ requirement_id: r1, kind: "profundizar", question: "¿Cómo?", listen_for: "" }], stale));
  });
});

describe("anonimización", () => {
  it("anonymize_candidate borra las preguntas", async () => {
    const { applicationId, candidateId, r1 } = await setup();
    await drain();
    const id = await request(applicationId);
    await claimJob(id!);
    await startJob(id!, [{ requirement_id: r1, kind: "profundizar" }]);
    await completeJob(id!, [{ requirement_id: r1, kind: "profundizar", question: "En Comercial Andina, ¿cómo?", listen_for: "" }]);
    await setStatus(applicationId, "no_seleccionado", "Perfil no compatible");
    await asActor(db, user(admin), () => db.query("select public.anonymize_candidate($1)", [candidateId]));
    expect((await row(id!)).questions).toEqual([]);
  });

  it("anonimizar cierra los trabajos abiertos y su resultado posterior se rechaza", async () => {
    const { applicationId, candidateId, r1 } = await setup();
    await setStatus(applicationId, "no_seleccionado", "Perfil no compatible");
    await drain();
    const id = await request(applicationId);
    await claimJob(id!);
    await startJob(id!, [{ requirement_id: r1, kind: "profundizar" }]);
    await asActor(db, user(admin), () => db.query("select public.anonymize_candidate($1)", [candidateId]));
    await expectError(completeJob(id!, [{ requirement_id: r1, kind: "profundizar", question: "En Comercial Andina, ¿cómo?", listen_for: "" }]));
    const closed = await row(id!);
    expect(closed.status).toBe("error");
    expect(closed.error_code).toBe("anonimizado");
    expect(closed.questions).toEqual([]);
  });
});
