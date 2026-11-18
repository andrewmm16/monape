import { createHash } from "node:crypto";
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
 * Cola de evaluaciones con IA: encolado (personal y sistema), reserva por el
 * worker, liberación (reintento, límite del plan, error) y cierre con el
 * registro de la evaluación en una sola transacción.
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

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Vacante con criterios aprobados, un requisito y una postulación. */
async function setup(approve = true) {
  const vacancyId = await createVacancy(db);
  const requirementId = await addRequirement(db, vacancyId, { description: "Excel avanzado", weight: 5 });
  const criteriaVersion = approve ? await approveCriteria(db, vacancyId) : 0;
  const candidateId = await createCandidate(db);
  const applicationId = await createApplication(db, candidateId, vacancyId);
  return { vacancyId, requirementId, criteriaVersion, applicationId };
}

const request = (applicationId: string, automatic = false) =>
  asActor(db, user(rrhh), () =>
    db.query<{ id: string | null }>("select public.request_ai_evaluation($1, $2) as id", [applicationId, automatic]),
  ).then((r) => r.rows[0]!.id);

type Claimed = { job_id: string; application_id: string; attempts: number; claim_token: string };
/** Token de la última reserva de cada trabajo (lo que el worker recibe y devuelve). */
const tokens = new Map<string, string>();
const claim = () =>
  asService(() => db.query<Claimed>("select * from public.ai_claim_job()")).then((r) => {
    const job = r.rows[0];
    if (job) tokens.set(job.job_id, job.claim_token);
    return job;
  });

/** Reserva hasta vaciar la cola disponible (otras pruebas pueden haber dejado trabajos). */
async function drain() {
  for (let i = 0; i < 100; i++) if (!(await claim())) return;
}

/** Reserva trabajos hasta encontrar el de `id`. */
async function claimJob(id: string): Promise<Claimed | undefined> {
  for (let i = 0; i < 100; i++) {
    const job = await claim();
    if (!job) return undefined;
    if (job.job_id === id) return job;
  }
  return undefined;
}

const release = (
  id: string,
  outcome: string,
  code: string | null = null,
  retryAt: string | null = null,
  token: string | null = tokens.get(id) ?? null,
) =>
  asService(() =>
    db.query<{ status: string }>("select public.ai_release_job($1, $2, $3, $4, $5) as status", [id, token, outcome, code, retryAt]),
  ).then((r) => r.rows[0]!.status);

const start = (id: string, inputSha: string, criteriaVersion: number) =>
  asService(() => db.query("select public.ai_start_job($1, $2, $3, $4)", [id, tokens.get(id) ?? null, inputSha, criteriaVersion]));

const jobRow = async (id: string) =>
  (
    await db.query<{
      status: string;
      origin: string;
      attempts: number;
      error_code: string | null;
      requested_by: string | null;
      available_at: Date;
      evaluation_id: string | null;
      finished_at: Date | null;
    }>("select * from public.ai_evaluation_jobs where id = $1", [id])
  ).rows[0]!;

/** Vuelve disponible un trabajo en espera (simula el paso del tiempo). */
const makeAvailable = (id: string) =>
  db.query("update public.ai_evaluation_jobs set available_at = now() - interval '1 second' where id = $1", [id]);

function completeArgs(jobId: string, criteriaVersion: number, requirementId: string, inputSha: string) {
  return [
    jobId,
    tokens.get(jobId) ?? null,
    null,
    criteriaVersion,
    "ia-prompt-v1",
    "v1",
    "claude-opus-5-5",
    100,
    100,
    100,
    "alta",
    "Resumen de prueba.",
    [],
    inputSha,
    JSON.stringify([{ requirement_id: requirementId, assessment: "acreditado", evidence: [{ quote: "Excel avanzado" }], rationale: "Cita literal." }]),
  ];
}

const complete = (args: unknown[]) =>
  asService(() =>
    db.query<{ id: string }>(
      `select public.ai_complete_job($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::public.compatibility_level, $12, $13, $14, $15::jsonb) as id`,
      args,
    ),
  ).then((r) => r.rows[0]!.id);

describe("encolado", () => {
  it("el personal encola una solicitud manual y pedirla otra vez devuelve el mismo trabajo", async () => {
    const { applicationId } = await setup();
    const first = await request(applicationId);
    const second = await request(applicationId);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    const row = await jobRow(first!);
    expect(row).toMatchObject({ status: "pendiente", origin: "manual", requested_by: rrhh, attempts: 0 });
  });

  it("una solicitud manual adelanta un trabajo automático abierto", async () => {
    const { applicationId } = await setup();
    const automatic = await request(applicationId, true);
    expect((await jobRow(automatic!)).origin).toBe("automatico");
    expect((await jobRow(automatic!)).requested_by).toBeNull();
    const manual = await request(applicationId);
    expect(manual).toBe(automatic);
    expect(await jobRow(manual!)).toMatchObject({ origin: "manual", requested_by: rrhh });
  });

  it("rechaza vacantes sin criterios aprobados", async () => {
    const { applicationId } = await setup(false);
    const error = await expectError(request(applicationId));
    expect(error.message).toMatch(/criterios/i);
  });

  it("anon no puede encolar ni el personal puede usar el ciclo del worker", async () => {
    const { applicationId } = await setup();
    await expectError(
      asActor(db, anon, () => db.query("select public.request_ai_evaluation($1)", [applicationId])),
    );
    await expectError(asActor(db, user(rrhh), () => db.query("select * from public.ai_claim_job()")));
    await expectError(
      asActor(db, user(rrhh), () => db.query("select public.enqueue_system_ai_evaluation($1)", [applicationId])),
    );
  });

  it("el sistema encola trabajos automáticos sin actor", async () => {
    const { applicationId } = await setup();
    const { rows } = await asService(() =>
      db.query<{ id: string }>("select public.enqueue_system_ai_evaluation($1) as id", [applicationId]),
    );
    expect(await jobRow(rows[0]!.id)).toMatchObject({ origin: "automatico", requested_by: null });
  });

  it("el personal ve los trabajos de sus postulaciones; anon no", async () => {
    const { applicationId } = await setup();
    const id = await request(applicationId);
    const visible = await asActor(db, user(rrhh), () =>
      db.query("select id from public.ai_evaluation_jobs where id = $1", [id]),
    );
    expect(visible.rows).toHaveLength(1);
    await expectError(asActor(db, anon, () => db.query("select id from public.ai_evaluation_jobs")));
  });
});

describe("reserva y liberación", () => {
  it("atiende primero las solicitudes manuales y no entrega dos veces un trabajo reservado", async () => {
    await drain();
    const a = await setup();
    const b = await setup();
    const automatic = await request(a.applicationId, true);
    const manual = await request(b.applicationId);

    const first = await claim();
    expect(first).toMatchObject({ job_id: manual, application_id: b.applicationId, attempts: 1 });
    expect((await jobRow(manual!)).status).toBe("procesando");

    const second = await claim();
    expect(second?.job_id).toBe(automatic);
    expect(await claim()).toBeUndefined();
  });

  it("reintentar espera, guarda el motivo y al tercer intento cierra con error", async () => {
    const { applicationId } = await setup();
    const id = (await request(applicationId))!;

    for (let attempt = 1; attempt <= 2; attempt++) {
      expect((await claimJob(id))?.attempts).toBe(attempt);
      expect(await release(id, "reintentar", "respuesta_invalida")).toBe("pendiente");
      const row = await jobRow(id);
      expect(row.error_code).toBe("respuesta_invalida");
      expect(row.available_at.getTime()).toBeGreaterThan(Date.now());
      await makeAvailable(id);
    }

    expect((await claimJob(id))?.attempts).toBe(3);
    expect(await release(id, "reintentar", "respuesta_invalida")).toBe("error");
    expect(await jobRow(id)).toMatchObject({ status: "error", error_code: "respuesta_invalida" });
    expect((await jobRow(id)).finished_at).not.toBeNull();
  });

  it("el límite del plan no cuenta como intento y espera hasta la renovación", async () => {
    const { applicationId } = await setup();
    const id = (await request(applicationId))!;
    await claimJob(id);
    const resetAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(await release(id, "limite", null, resetAt.toISOString())).toBe("pendiente");
    const row = await jobRow(id);
    expect(row).toMatchObject({ status: "pendiente", attempts: 0, error_code: "limite_plan" });
    expect(Math.abs(row.available_at.getTime() - resetAt.getTime())).toBeLessThan(2_000);
    // En espera no se entrega.
    expect(await claimJob(id)).toBeUndefined();
  });

  it("una sesión caducada también espera sin contar intento y deja su motivo", async () => {
    const { applicationId } = await setup();
    const id = (await request(applicationId))!;
    await claimJob(id);
    expect(await release(id, "limite", "sin_sesion")).toBe("pendiente");
    expect(await jobRow(id)).toMatchObject({ status: "pendiente", attempts: 0, error_code: "sin_sesion" });
  });

  it("un error definitivo cierra el trabajo y permite encolar otro", async () => {
    const { applicationId } = await setup();
    const id = (await request(applicationId))!;
    await claimJob(id);
    expect(await release(id, "error", "sin_texto")).toBe("error");
    const next = await request(applicationId);
    expect(next).not.toBe(id);
  });

  it("rechaza resultados desconocidos y trabajos no reservados", async () => {
    const { applicationId } = await setup();
    const id = (await request(applicationId))!;
    await expectError(release(id, "reintentar"));
    await claimJob(id);
    await expectError(release(id, "otra_cosa"));
    await expectError(release(id, "error", "Código Inválido"));
  });

  it("quien perdió la reserva (venció) no puede liberar ni cerrar el trabajo que tomó otro", async () => {
    const { applicationId, requirementId, criteriaVersion } = await setup();
    const id = (await request(applicationId))!;
    const first = (await claimJob(id))!;
    // La reserva vence (worker caído o lento) y otro worker la toma.
    await db.query("update public.ai_evaluation_jobs set claimed_at = now() - interval '11 minutes' where id = $1", [id]);
    const second = (await claimJob(id))!;
    expect(second.claim_token).not.toBe(first.claim_token);
    expect(second.attempts).toBe(2);

    const stale = first.claim_token;
    await expectError(release(id, "error", "cli_error", null, stale));
    await expectError(
      asService(() => db.query("select public.ai_start_job($1, $2, $3, $4)", [id, stale, sha("x"), criteriaVersion])),
    );
    await start(id, sha("x"), criteriaVersion);
    const args = completeArgs(id, criteriaVersion, requirementId, sha("x"));
    args[1] = stale;
    await expectError(complete(args));
    expect(await jobRow(id)).toMatchObject({ status: "procesando", attempts: 2 });
    // El worker vigente sí puede cerrarlo.
    expect(await complete(completeArgs(id, criteriaVersion, requirementId, sha("x")))).toBeTruthy();
  });
});

describe("estado del worker", () => {
  const beat = (state: string, reason: string | null = null, until: string | null = null, version: string | null = null) =>
    asService(() =>
      db.query<{ changed: boolean }>("select public.ai_worker_heartbeat($1, $2, $3, $4) as changed", [state, reason, until, version]),
    ).then((r) => r.rows[0]!.changed);
  const statusRow = async () =>
    (await db.query<{ state: string; pause_reason: string | null; cli_version: string | null; state_since: Date }>(
      "select * from public.ai_worker_status",
    )).rows[0];

  it("registra latidos e informa solo los cambios de estado o de motivo", async () => {
    expect(await beat("activo", null, null, "2.1.325 (Claude Code)")).toBe(true);
    const since = (await statusRow())!.state_since;
    expect(await beat("activo")).toBe(false);
    expect(await statusRow()).toMatchObject({ state: "activo", cli_version: "2.1.325 (Claude Code)", state_since: since });
    expect(await beat("pausado", "sin_sesion", new Date(Date.now() + 600_000).toISOString())).toBe(true);
    expect(await beat("pausado", "sin_sesion")).toBe(false);
    expect(await beat("pausado", "limite_plan")).toBe(true);
    expect(await statusRow()).toMatchObject({ state: "pausado", pause_reason: "limite_plan" });
    expect(await beat("activo")).toBe(true);
  });

  it("rechaza estados o motivos inválidos y solo lo escribe el sistema; el personal lo lee", async () => {
    await expectError(beat("pausado"));
    await expectError(beat("activo", "sin_sesion"));
    await expectError(beat("otro"));
    await expectError(asActor(db, user(rrhh), () => db.query("select public.ai_worker_heartbeat('activo')")));
    const visible = await asActor(db, user(rrhh), () => db.query("select state from public.ai_worker_status"));
    expect(visible.rows).toHaveLength(1);
    await expectError(asActor(db, anon, () => db.query("select state from public.ai_worker_status")));
  });
});

describe("cierre con la evaluación", () => {
  it("registra la evaluación con IA a nombre de quien la pidió y la deja vigente", async () => {
    const { applicationId, requirementId, criteriaVersion } = await setup();
    const id = (await request(applicationId))!;
    await claimJob(id);
    const inputSha = sha("texto enviado");
    await start(id, inputSha, criteriaVersion);

    const evaluationId = await complete(completeArgs(id, criteriaVersion, requirementId, inputSha));

    const evaluation = (
      await db.query<{ method: string; created_by: string | null; model: string; level: string }>(
        "select method, created_by, model, level from public.candidate_evaluations where id = $1",
        [evaluationId],
      )
    ).rows[0]!;
    expect(evaluation).toMatchObject({ method: "ia", created_by: rrhh, model: "claude-opus-5-5", level: "alta" });
    const latest = await db.query<{ latest_evaluation_id: string }>(
      "select latest_evaluation_id from public.applications where id = $1",
      [applicationId],
    );
    expect(latest.rows[0]!.latest_evaluation_id).toBe(evaluationId);
    expect(await jobRow(id)).toMatchObject({ status: "completado", evaluation_id: evaluationId, error_code: null });
  });

  it("rechaza el cierre si el texto o los criterios cambiaron desde la reserva", async () => {
    const { applicationId, requirementId, criteriaVersion } = await setup();
    const id = (await request(applicationId))!;
    await claimJob(id);
    await start(id, sha("original"), criteriaVersion);

    const error = await expectError(complete(completeArgs(id, criteriaVersion, requirementId, sha("otro texto"))));
    expect(error.message).toMatch(/cambiaron/);
    expect((await jobRow(id)).status).toBe("procesando");

    // Reprogramar lo devuelve a la cola sin contar el intento.
    expect(await release(id, "reprogramar")).toBe("pendiente");
    expect(await jobRow(id)).toMatchObject({ attempts: 0, error_code: null });
  });

  it("el encolado automático no se repite si ya hay una evaluación con IA del mismo CV y criterios", async () => {
    const { applicationId, requirementId, criteriaVersion } = await setup();
    const id = (await request(applicationId))!;
    await claimJob(id);
    const inputSha = sha("texto");
    await start(id, inputSha, criteriaVersion);
    await complete(completeArgs(id, criteriaVersion, requirementId, inputSha));

    expect(await request(applicationId, true)).toBeNull();
    // Una solicitud manual siempre se acepta.
    expect(await request(applicationId)).toBeTruthy();
  });
});
