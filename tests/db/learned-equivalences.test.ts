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
 * El motor aprende de la IA: votos de la IA por CV distinto, umbral sin votos en
 * contra, segundo juez, suspensión automática (la IA o RRHH lo contradicen),
 * deshacer por administración y de dónde sale cada valoración en los ítems.
 */
let db: PGlite;
let rrhh: string;
let admin: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
  admin = await createUser(db, "admin", "Admin Ficticio");
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

const MIN = 5;
let keySeq = 0;
const newKey = () => `experiencia:minimo 5 anos en supervision de obras ${++keySeq}`;

async function vote(key: string, term: string, candidateId: string, equivalent: boolean): Promise<string> {
  return asService(() =>
    db.query<{ status: string }>(
      `select public.learn_record_vote($1, 'experiencia', 'Mínimo 5 años en supervisión de obras', $2, $3, $4, null, $5, 'Motivo.', $6) as status`,
      [key, term, term, candidateId, equivalent, MIN],
    ),
  ).then((r) => r.rows[0]!.status);
}

const rule = async (key: string, term: string) =>
  (
    await db.query<{ id: string; status: string; verdict: string | null; votes_yes: number; votes_no: number; status_reason: string | null }>(
      "select id, status, verdict, votes_yes, votes_no, status_reason from public.learned_equivalences where requirement_key = $1 and cv_term = $2",
      [key, term],
    )
  ).rows[0]!;

async function candidates(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await createCandidate(db, `Persona Ficticia ${i}`));
  return ids;
}

type Claimed = { equivalence_id: string; judge_token: string; verdict: string; votes: number };
const claimJudgment = () =>
  asService(() => db.query<Claimed>("select * from public.learn_claim_judgment()")).then((r) => r.rows);
const reportJudgment = (id: string, token: string, equivalent: boolean) =>
  asService(() =>
    db.query<{ s: string }>("select public.learn_report_judgment($1, $2, $3, 'Motivo del juez.', 'claude-opus-5-5') as s", [id, token, equivalent]),
  ).then((r) => r.rows[0]!.s);

/** Lleva una regla «equivale» hasta activa (5 votos + juez de acuerdo). */
async function activeRule(key: string, term: string): Promise<string> {
  for (const c of await candidates(MIN)) await vote(key, term, c, true);
  const [claimed] = await claimJudgment();
  expect(claimed!.equivalence_id).toBe((await rule(key, term)).id);
  expect(await reportJudgment(claimed!.equivalence_id, claimed!.judge_token, true)).toBe("activa");
  return claimed!.equivalence_id;
}

describe("votos de la IA", () => {
  it("con 5 CV distintos a favor y ninguno en contra, pasa al segundo juez; el mismo CV cuenta una vez", async () => {
    const key = newKey();
    const [a, b, c, d, e] = await candidates(5);
    expect(await vote(key, "asistente de residencia", a!, true)).toBe("aprendiendo");
    expect(await vote(key, "asistente de residencia", a!, true)).toBe("aprendiendo"); // mismo candidato
    for (const x of [b!, c!, d!]) expect(await vote(key, "asistente de residencia", x, true)).toBe("aprendiendo");
    expect(await rule(key, "asistente de residencia")).toMatchObject({ votes_yes: 4, verdict: null });
    expect(await vote(key, "asistente de residencia", e!, true)).toBe("pendiente_juez");
    expect(await rule(key, "asistente de residencia")).toMatchObject({ status: "pendiente_juez", verdict: "equivale", votes_yes: 5 });
    // Se libera para las demás pruebas.
    const [claimed] = await claimJudgment();
    await reportJudgment(claimed!.equivalence_id, claimed!.judge_token, true);
  });

  it("un solo voto en contra lo bloquea: nunca llega al umbral", async () => {
    const key = newKey();
    const cs = await candidates(8);
    await vote(key, "maestro de obra", cs[0]!, false);
    for (const c of cs.slice(1)) expect(await vote(key, "maestro de obra", c, true)).toBe("aprendiendo");
    expect(await rule(key, "maestro de obra")).toMatchObject({ status: "aprendiendo", verdict: null, votes_yes: 7, votes_no: 1 });
  });

  it("también aprende lo que NO equivale", async () => {
    const key = newKey();
    for (const c of await candidates(MIN)) await vote(key, "almacenero", c, false);
    expect(await rule(key, "almacenero")).toMatchObject({ status: "pendiente_juez", verdict: "no_equivale" });
    const [claimed] = await claimJudgment();
    expect(claimed).toMatchObject({ verdict: "no_equivale", votes: MIN });
    expect(await reportJudgment(claimed!.equivalence_id, claimed!.judge_token, false)).toBe("activa");
  });

  it("solo el sistema registra votos", async () => {
    await expectError(
      asActor(db, user(admin), () =>
        db.query("select public.learn_record_vote('k:x', 'experiencia', 'x', 'yy', 'yy', gen_random_uuid(), null, true, '', 5)"),
      ),
    );
  });
});

describe("segundo juez", () => {
  it("si el juez no está de acuerdo, la regla se rechaza; un token ajeno se ignora", async () => {
    const key = newKey();
    for (const c of await candidates(MIN)) await vote(key, "ayudante de obra", c, true);
    const [claimed] = await claimJudgment();
    expect(await reportJudgment(claimed!.equivalence_id, "00000000-0000-4000-8000-000000000000", true)).toBe("ignorado");
    expect(await reportJudgment(claimed!.equivalence_id, claimed!.judge_token, false)).toBe("rechazada");
    expect(await rule(key, "ayudante de obra")).toMatchObject({ status: "rechazada" });
    expect(await claimJudgment()).toEqual([]);
  });

  it("una reserva liberada (límite del plan) vuelve a entregarse", async () => {
    const key = newKey();
    for (const c of await candidates(MIN)) await vote(key, "jefe de cuadrilla", c, true);
    const [first] = await claimJudgment();
    expect(await claimJudgment()).toEqual([]); // reservada
    await asService(() => db.query("select public.learn_release_judgment($1, $2)", [first!.equivalence_id, first!.judge_token]));
    const [again] = await claimJudgment();
    expect(again!.equivalence_id).toBe(first!.equivalence_id);
    expect(again!.judge_token).not.toBe(first!.judge_token);
    await reportJudgment(again!.equivalence_id, again!.judge_token, true);
  });
});

describe("suspensión y deshacer", () => {
  it("una regla activa se suspende sola si la IA opina lo contrario en otro CV", async () => {
    const key = newKey();
    await activeRule(key, "capataz");
    const [otro] = await candidates(1);
    expect(await vote(key, "capataz", otro!, false)).toBe("suspendida");
    expect((await rule(key, "capataz")).status_reason).toMatch(/opinó lo contrario/);
  });

  it("administración la desactiva y la reactiva; RRHH no puede", async () => {
    const key = newKey();
    const id = await activeRule(key, "residente de campo");
    const set = (actor: string, active: boolean) =>
      asActor(db, user(actor), () => db.query("select public.set_learned_equivalence_active($1, $2)", [id, active]));
    await expectError(set(rrhh, false));
    await set(admin, false);
    expect(await rule(key, "residente de campo")).toMatchObject({ status: "suspendida", status_reason: "Desactivada por administración." });
    await expectError(set(admin, false));
    await set(admin, true);
    expect((await rule(key, "residente de campo")).status).toBe("activa");
  });

  it("RRHH verifica «no cumple» en un requisito que la regla acreditó: la regla se suspende", async () => {
    const key = newKey();
    const ruleId = await activeRule(key, "encargado de obra");
    const vacancyId = await createVacancy(db);
    const requirementId = await addRequirement(db, vacancyId, { description: "Supervisión de obras", weight: 5, category: "experiencia" });
    const criteria = await approveCriteria(db, vacancyId);
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    const items = [
      {
        requirement_id: requirementId,
        assessment: "acreditado",
        evidence: [{ quote: "Encargado de obra 2015 - 2024" }],
        rationale: "Equivalencia aprendida.",
        resolved_by: "regla_aprendida",
        engine_assessment: "pendiente_verificacion",
        learned_equivalence_id: ruleId,
      },
    ];
    const evaluationId = await asActor(db, user(rrhh), () =>
      db.query<{ id: string }>(
        `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v11', 'v1', null, 100, 100, 100,
           'alta'::public.compatibility_level, 'Resumen', array[]::text[], null, $3::jsonb) as id`,
        [applicationId, criteria, JSON.stringify(items)],
      ),
    ).then((r) => r.rows[0]!.id);

    // Las columnas nuevas se guardan.
    const stored = (
      await db.query<{ resolved_by: string; engine_assessment: string; learned_equivalence_id: string }>(
        "select resolved_by, engine_assessment, learned_equivalence_id from public.candidate_evaluation_items where evaluation_id = $1",
        [evaluationId],
      )
    ).rows[0]!;
    expect(stored).toEqual({ resolved_by: "regla_aprendida", engine_assessment: "pendiente_verificacion", learned_equivalence_id: ruleId });

    await asActor(db, user(rrhh), () =>
      db.query("select public.verify_requirements($1, $2::jsonb)", [
        applicationId,
        JSON.stringify([{ requirement_id: requirementId, result: "no_cumplido", source: "entrevista", note: "Era ayudante, no encargado." }]),
      ]),
    );
    expect(await rule(key, "encargado de obra")).toMatchObject({ status: "suspendida" });
    expect((await rule(key, "encargado de obra")).status_reason).toMatch(/RRHH verificó/);
  });

  it("valores desconocidos en las columnas nuevas se ignoran", async () => {
    const vacancyId = await createVacancy(db);
    const requirementId = await addRequirement(db, vacancyId, { description: "Excel", weight: 5 });
    const criteria = await approveCriteria(db, vacancyId);
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    const evaluationId = await asActor(db, user(rrhh), () =>
      db.query<{ id: string }>(
        `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v11', 'v1', null, 100, 100, 100,
           'alta'::public.compatibility_level, 'Resumen', array[]::text[], null, $3::jsonb) as id`,
        [
          applicationId,
          criteria,
          JSON.stringify([
            {
              requirement_id: requirementId,
              assessment: "acreditado",
              evidence: [],
              rationale: "x",
              resolved_by: "otro",
              engine_assessment: "inventado",
              learned_equivalence_id: "no-es-uuid",
            },
          ]),
        ],
      ),
    ).then((r) => r.rows[0]!.id);
    const stored = (
      await db.query("select resolved_by, engine_assessment, learned_equivalence_id from public.candidate_evaluation_items where evaluation_id = $1", [
        evaluationId,
      ])
    ).rows[0];
    expect(stored).toEqual({ resolved_by: null, engine_assessment: null, learned_equivalence_id: null });
  });
});

describe("acceso", () => {
  it("el personal ve las reglas; los votos (vinculados a candidatos) solo administración; anónimos nada", async () => {
    const reglas = await asActor(db, user(rrhh), () => db.query("select id from public.learned_equivalences"));
    expect(reglas.rows.length).toBeGreaterThan(0);
    const votosRrhh = await asActor(db, user(rrhh), () => db.query("select 1 from public.learned_equivalence_votes"));
    expect(votosRrhh.rows).toHaveLength(0);
    const votosAdmin = await asActor(db, user(admin), () => db.query("select 1 from public.learned_equivalence_votes"));
    expect(votosAdmin.rows.length).toBeGreaterThan(0);
    await expectError(asActor(db, anon, () => db.query("select id from public.learned_equivalences")));
    await expectError(asActor(db, user(rrhh), () => db.query("update public.learned_equivalences set status = 'activa'")));
  });
});
