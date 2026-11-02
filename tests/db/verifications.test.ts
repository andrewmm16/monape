import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assembleEvaluation } from "@/modules/evaluation/assemble";
import { applyVerifications, type RequirementVerification } from "@/modules/evaluation/verifications";
import type { Assessment, ItemAssessment, RequirementInput } from "@/modules/evaluation/types";
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
 * Verificaciones de requisitos por RRHH: tabla, funciones, auditoría y su
 * efecto en record_evaluation (valida y copia desde la tabla).
 */
let db: PGlite;
const ids = {} as {
  rrhh: string;
  admin: string;
  inactivo: string;
  vacancy: string;
  otherVacancy: string;
  application: string;
  ingles: string;
  sql: string;
  deseable: string;
  foreign: string;
  version: number;
};

beforeAll(async () => {
  db = await createTestDatabase();
  ids.rrhh = await createUser(db, "rrhh", "Luis Ficticio");
  ids.admin = await createUser(db, "admin", "Admin Ficticio");
  ids.inactivo = await createUser(db, "rrhh", "RRHH Inactivo");
  await db.query("update public.profiles set is_active = false where id = $1", [ids.inactivo]);

  ids.vacancy = await createVacancy(db, { title: "Analista bilingüe" });
  ids.ingles = await addRequirement(db, ids.vacancy, { description: "Inglés intermedio", weight: 5, priority: "obligatorio", category: "idioma" });
  ids.sql = await addRequirement(db, ids.vacancy, { description: "SQL", weight: 3, priority: "obligatorio" });
  ids.deseable = await addRequirement(db, ids.vacancy, { description: "Power BI", weight: 2, priority: "deseable" });
  ids.version = await approveCriteria(db, ids.vacancy);
  ids.application = await createApplication(db, await createCandidate(db), ids.vacancy);

  ids.otherVacancy = await createVacancy(db, { title: "Otra vacante" });
  ids.foreign = await addRequirement(db, ids.otherVacancy, { description: "Requisito ajeno", weight: 1 });
});

afterAll(async () => {
  await db?.close();
});

const item = (requirementId: string, result = "acreditado", note = "Conversación fluida de 10 minutos", source = "entrevista") => ({
  requirement_id: requirementId,
  result,
  source,
  note,
});

const verify = (actor: Parameters<typeof asActor>[1], items: unknown, application = ids.application) =>
  asActor(db, actor, () =>
    db.query<{ n: number }>("select public.verify_requirements($1, $2::jsonb) as n", [application, JSON.stringify(items)]),
  );

async function verifications() {
  const { rows } = await db.query<{ requirement_id: string; result: string; source: string; note: string; verified_by: string | null }>(
    "select requirement_id, result, source, note, verified_by from public.requirement_verifications where application_id = $1 order by note",
    [ids.application],
  );
  return rows;
}

async function events() {
  const { rows } = await db.query<{ event_type: string; note: string | null; actor_id: string | null }>(
    "select event_type, note, actor_id from public.application_events where application_id = $1 and event_type = 'requisito_verificado' order by id",
    [ids.application],
  );
  return rows;
}

const requirementsOf = (): RequirementInput[] => [
  { id: ids.ingles, category: "idioma", priority: "obligatorio", description: "", keywords: [], weight: 5, minYears: null, isEssential: false },
  { id: ids.sql, category: "habilidad_tecnica", priority: "obligatorio", description: "", keywords: [], weight: 3, minYears: null, isEssential: false },
  { id: ids.deseable, category: "habilidad_tecnica", priority: "deseable", description: "", keywords: [], weight: 2, minYears: null, isEssential: false },
];

/** Registra una evaluación con los números de `items`; `rawItems` sustituye lo que se envía como ítems. */
async function record(items: ItemAssessment[], rawItems?: unknown) {
  const result = assembleEvaluation({
    method: "reglas",
    methodVersion: "reglas-v1",
    model: null,
    requirements: requirementsOf(),
    items,
    textWasCorrected: false,
    textTruncated: false,
  });
  const payload =
    rawItems ??
    result.items.map((i) => ({
      requirement_id: i.requirementId,
      assessment: i.assessment,
      rationale: i.rationale,
      ...(i.cvAssessment ? { cv_assessment: i.cvAssessment } : {}),
    }));
  const { rows } = await asActor(db, user(ids.rrhh), () =>
    db.query<{ id: string }>(
      `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v1', $3, null, $4, $5, $6,
         $7::public.compatibility_level, $8, $9, null, $10::jsonb) as id`,
      [
        ids.application,
        ids.version,
        result.scoringVersion,
        result.scores.score,
        result.scores.potential,
        result.scores.coverage,
        result.level,
        result.summary,
        result.limitations,
        JSON.stringify(payload),
      ],
    ),
  );
  return { id: rows[0]!.id, result };
}

const cv = (requirementId: string, assessment: Assessment): ItemAssessment => ({
  requirementId,
  assessment,
  evidence: [],
  rationale: "Según el motor",
});

describe("autorización", () => {
  it("rechaza al anónimo y a quien no es personal activo", async () => {
    await expectError(verify(anon, [item(ids.ingles)]));
    await expectError(verify(user(ids.inactivo), [item(ids.ingles)]));
    expect(await verifications()).toEqual([]);
  });

  it("no permite escribir ni borrar directamente en la tabla", async () => {
    await expectError(
      asActor(db, user(ids.rrhh), () =>
        db.query(
          "insert into public.requirement_verifications (application_id, requirement_id, result, source, note) values ($1, $2, 'acreditado', 'otro', 'abc')",
          [ids.application, ids.ingles],
        ),
      ),
    );
    await expectError(asActor(db, user(ids.rrhh), () => db.query("delete from public.requirement_verifications")));
    await expectError(asActor(db, anon, () => db.query("select * from public.requirement_verifications")));
  });

  it("el personal activo puede leer; el inactivo no ve nada", async () => {
    await verify(user(ids.rrhh), [item(ids.deseable, "acreditado", "Dominio comprobado en la prueba")]);
    const seen = await asActor(db, user(ids.rrhh), () => db.query("select 1 from public.requirement_verifications"));
    expect(seen.rows).toHaveLength(1);
    const hidden = await asActor(db, user(ids.inactivo), () => db.query("select 1 from public.requirement_verifications"));
    expect(hidden.rows).toHaveLength(0);
    await asActor(db, user(ids.rrhh), () =>
      db.query("select public.remove_requirement_verification($1, $2, 'Se limpia la prueba')", [ids.application, ids.deseable]),
    );
    expect(await verifications()).toEqual([]);
  });

  it("remove_requirement_verification exige personal", async () => {
    await expectError(
      asActor(db, anon, () => db.query("select public.remove_requirement_verification($1, $2, 'Nota válida')", [ids.application, ids.ingles])),
    );
  });
});

describe("validación de verify_requirements", () => {
  it("rechaza requisitos de otra vacante, entradas mal formadas y duplicados", async () => {
    expect((await expectError(verify(user(ids.rrhh), [item(ids.foreign)]))).message).toMatch(/no pertenece a la vacante/);
    expect((await expectError(verify(user(ids.rrhh), []))).message).toMatch(/de 1 a 30/);
    expect((await expectError(verify(user(ids.rrhh), Array.from({ length: 31 }, () => item(ids.ingles))))).message).toMatch(/de 1 a 30/);
    expect((await expectError(verify(user(ids.rrhh), { requirement_id: ids.ingles }))).message).toMatch(/de 1 a 30/);
    expect((await expectError(verify(user(ids.rrhh), [item(ids.ingles, "sin_evidencia")]))).message).toMatch(/resultado/);
    expect((await expectError(verify(user(ids.rrhh), [item(ids.ingles, "acreditado", "ok")]))).message).toMatch(/nota/);
    expect((await expectError(verify(user(ids.rrhh), [item(ids.ingles, "acreditado", "x".repeat(1001))]))).message).toMatch(/nota/);
    expect((await expectError(verify(user(ids.rrhh), [item(ids.ingles, "acreditado", "Nota válida", "adivino")]))).message).toMatch(/fuente/);
    expect((await expectError(verify(user(ids.rrhh), [item(ids.ingles), item(ids.ingles)]))).message).toMatch(/dos veces/);
    expect((await expectError(verify(user(ids.rrhh), [item(ids.ingles)], "00000000-0000-0000-0000-000000000000"))).message).toMatch(/no encontrada/);
    // Nada se guardó a medias.
    expect(await verifications()).toEqual([]);
  });
});

describe("guardado, cambio y borrado", () => {
  it("guarda varios requisitos, hace upsert y registra un evento por llamada", async () => {
    const before = (await events()).length;
    const saved = await verify(user(ids.rrhh), [
      item(ids.ingles, "acreditado", "Conversación fluida de 10 minutos"),
      item(ids.sql, "no_cumplido", "No resolvió la consulta", "prueba_tecnica"),
    ]);
    expect(saved.rows[0]!.n).toBe(2);
    const stored = await verifications();
    expect(stored).toHaveLength(2);
    expect(stored.find((r) => r.requirement_id === ids.ingles)).toMatchObject({ result: "acreditado", source: "entrevista", verified_by: ids.rrhh });
    expect(stored.find((r) => r.requirement_id === ids.sql)).toMatchObject({ result: "no_cumplido", source: "prueba_tecnica", verified_by: ids.rrhh });
    const afterFirst = await events();
    expect(afterFirst).toHaveLength(before + 1);
    expect(afterFirst.at(-1)).toMatchObject({ note: "2 requisitos verificados", actor_id: ids.rrhh });

    // Upsert: cambiar el inglés deja una sola fila vigente, a nombre de quien cambió.
    await verify(user(ids.admin), [item(ids.ingles, "no_cumplido", "  Nivel básico en la entrevista  ", "otro")]);
    expect((await verifications()).filter((r) => r.requirement_id === ids.ingles)).toEqual([
      { requirement_id: ids.ingles, result: "no_cumplido", source: "otro", note: "Nivel básico en la entrevista", verified_by: ids.admin },
    ]);
    expect((await events()).at(-1)!.note).toBe("1 requisito verificado");

    // Se restablece el estado para las pruebas siguientes.
    await verify(user(ids.rrhh), [item(ids.ingles, "acreditado", "Conversación fluida de 10 minutos")]);
  });

  it("quitar la verificación la borra, exige nota y registra el evento", async () => {
    await verify(user(ids.rrhh), [item(ids.deseable, "acreditado", "Dominio comprobado")]);
    const remove = (note: string, requirement = ids.deseable) =>
      asActor(db, user(ids.rrhh), () =>
        db.query("select public.remove_requirement_verification($1, $2, $3)", [ids.application, requirement, note]),
      );
    expect((await expectError(remove("  "))).message).toMatch(/nota/);
    await remove("Se registró en el candidato equivocado");
    expect((await verifications()).some((r) => r.requirement_id === ids.deseable)).toBe(false);
    expect((await events()).at(-1)!.note).toBe("Verificación quitada: Power BI. Se registró en el candidato equivocado");
    expect((await expectError(remove("Nota válida"))).message).toMatch(/no existe/);
  });
});

describe("auditoría", () => {
  it("registra altas, cambios y bajas de verificaciones", async () => {
    const { rows } = await db.query<{ action: string; actor_id: string | null }>(
      "select action, actor_id from public.audit_logs where entity_type = 'requirement_verifications' order by id",
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("insert");
    expect(actions).toContain("update");
    expect(actions).toContain("delete");
    expect(rows.find((r) => r.action === "update")!.actor_id).toBe(ids.admin);
  });
});

describe("record_evaluation con verificaciones", () => {
  // Estado de partida: inglés acreditado y SQL no cumplido, ambos verificados.
  const allCv = () => [cv(ids.ingles, "sin_evidencia"), cv(ids.sql, "acreditado"), cv(ids.deseable, "acreditado")];

  it("rechaza una valoración que contradice una verificación", async () => {
    const contradict = [
      { requirement_id: ids.ingles, assessment: "sin_evidencia", cv_assessment: "sin_evidencia" },
      { requirement_id: ids.sql, assessment: "no_cumplido", cv_assessment: "sin_evidencia" },
      { requirement_id: ids.deseable, assessment: "acreditado" },
    ];
    expect((await expectError(record(allCv(), contradict))).message).toBe("La evaluación no respeta las verificaciones registradas");
  });

  it("exige la valoración original del CV en los requisitos verificados", async () => {
    const missing = [
      { requirement_id: ids.ingles, assessment: "acreditado" },
      { requirement_id: ids.sql, assessment: "no_cumplido", cv_assessment: "no-es-valido" },
      { requirement_id: ids.deseable, assessment: "acreditado" },
    ];
    expect((await expectError(record(allCv(), missing))).message).toMatch(/valoración original/);
  });

  it("copia los campos desde la tabla y recalcula porcentajes y nivel", async () => {
    const now = new Date().toISOString();
    const verified: RequirementVerification[] = [
      { requirementId: ids.ingles, result: "acreditado", source: "entrevista", note: "x", verifiedAt: now, verifiedByName: "Luis" },
      { requirementId: ids.sql, result: "no_cumplido", source: "prueba_tecnica", note: "x", verifiedAt: now, verifiedByName: "Luis" },
    ];
    const items = applyVerifications(allCv(), verified);
    // El cliente intenta falsear los campos de copia: no se tienen en cuenta.
    const payload = items.map((i) => ({
      requirement_id: i.requirementId,
      assessment: i.assessment,
      rationale: i.rationale,
      ...(i.cvAssessment ? { cv_assessment: i.cvAssessment } : { cv_assessment: "acreditado" }),
      verification_source: "documento",
      verification_note: "falsa",
      verified_by: ids.admin,
      verified_at: "2000-01-01T00:00:00Z",
    }));
    const { id, result } = await record(items, payload);

    // SQL obligatorio verificado como «no cumple»: con 70 % no puede ser «alta».
    expect(result.scores.score).toBe(70);
    expect(result.level).toBe("parcial");
    const evaluation = await db.query<{ score: string; score_potential: string; evidence_coverage: string; level: string }>(
      "select score, score_potential, evidence_coverage, level from public.candidate_evaluations where id = $1",
      [id],
    );
    expect(evaluation.rows[0]).toMatchObject({ score: "70.00", score_potential: "70.00", evidence_coverage: "100.00", level: "parcial" });

    const { rows } = await db.query<{
      requirement_id: string;
      assessment: string;
      cv_assessment: string | null;
      verification_source: string | null;
      verification_note: string | null;
      verified_by: string | null;
      verified_at: Date | null;
    }>(
      `select requirement_id, assessment, cv_assessment, verification_source, verification_note, verified_by, verified_at
         from public.candidate_evaluation_items where evaluation_id = $1`,
      [id],
    );
    const byRequirement = new Map(rows.map((r) => [r.requirement_id, r]));
    expect(byRequirement.get(ids.ingles)).toMatchObject({
      assessment: "acreditado",
      cv_assessment: "sin_evidencia",
      verification_source: "entrevista",
      verification_note: "Conversación fluida de 10 minutos",
      verified_by: ids.rrhh,
    });
    expect(new Date(byRequirement.get(ids.ingles)!.verified_at!).getFullYear()).toBeGreaterThan(2000);
    expect(byRequirement.get(ids.sql)).toMatchObject({
      assessment: "no_cumplido",
      cv_assessment: "acreditado",
      verification_source: "prueba_tecnica",
      verification_note: "No resolvió la consulta",
    });
    // Sin verificación: columnas nulas, aunque el cliente envíe datos.
    expect(byRequirement.get(ids.deseable)).toMatchObject({
      cv_assessment: null,
      verification_source: null,
      verification_note: null,
      verified_by: null,
      verified_at: null,
    });
  });

  it("sin verificaciones, la evaluación de siempre se registra con las columnas nulas", async () => {
    const vacancy = await createVacancy(db, { title: "Sin verificaciones" });
    const requirement = await addRequirement(db, vacancy, { description: "Excel", weight: 4 });
    const version = await approveCriteria(db, vacancy);
    const application = await createApplication(db, await createCandidate(db), vacancy);
    const { rows } = await asActor(db, user(ids.rrhh), () =>
      db.query<{ id: string }>(
        `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v1', 'v1', null, 100, 100, 100,
           'alta', 's', array[]::text[], null, $3::jsonb) as id`,
        [application, version, JSON.stringify([{ requirement_id: requirement, assessment: "acreditado" }])],
      ),
    );
    const items = await db.query(
      "select cv_assessment, verification_source, verification_note, verified_by, verified_at from public.candidate_evaluation_items where evaluation_id = $1",
      [rows[0]!.id],
    );
    expect(items.rows).toEqual([
      { cv_assessment: null, verification_source: null, verification_note: null, verified_by: null, verified_at: null },
    ]);
  });

  it("un «no cumple» verificado en un obligatorio permite el nivel «baja»", async () => {
    const vacancy = await createVacancy(db, { title: "Nivel bajo verificado" });
    const mandatory = await addRequirement(db, vacancy, { description: "Licencia", weight: 8, priority: "obligatorio" });
    const rest = await addRequirement(db, vacancy, { description: "Excel", weight: 2, priority: "deseable" });
    const version = await approveCriteria(db, vacancy);
    const application = await createApplication(db, await createCandidate(db), vacancy);
    await asActor(db, user(ids.rrhh), () =>
      db.query("select public.verify_requirements($1, $2::jsonb)", [
        application,
        JSON.stringify([item(mandatory, "no_cumplido", "No presentó la licencia", "documento")]),
      ]),
    );
    const call = (level: string, items: unknown) =>
      asActor(db, user(ids.rrhh), () =>
        db.query<{ id: string }>(
          `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v1', 'v1', null, 20, 20, 100,
             $3::public.compatibility_level, 's', array[]::text[], null, $4::jsonb) as id`,
          [application, version, level, JSON.stringify(items)],
        ),
      );
    const items = [
      { requirement_id: mandatory, assessment: "no_cumplido", cv_assessment: "acreditado" },
      { requirement_id: rest, assessment: "acreditado" },
    ];
    expect((await expectError(call("parcial", items))).message).toMatch(/nivel no coincide/);
    expect((await call("baja", items)).rows[0]!.id).toBeTruthy();
  });
});

describe("cv_rationale", () => {
  const cvItems = () => [cv(ids.ingles, "sin_evidencia"), cv(ids.sql, "acreditado"), cv(ids.deseable, "acreditado")];

  it("se guarda solo en los requisitos verificados y se recorta a 2000", async () => {
    const now = new Date().toISOString();
    // Verificaciones vigentes en este punto: inglés (cumple) y SQL (no cumple).
    const verified: RequirementVerification[] = [
      { requirementId: ids.ingles, result: "acreditado", source: "entrevista", note: "x", verifiedAt: now, verifiedByName: "Luis" },
      { requirementId: ids.sql, result: "no_cumplido", source: "prueba_tecnica", note: "x", verifiedAt: now, verifiedByName: "Luis" },
    ];
    const items = applyVerifications(
      cvItems().map((i) => ({ ...i, rationale: i.requirementId === ids.sql ? "m".repeat(2500) : `Motivo de ${i.requirementId === ids.ingles ? "inglés" : "Power BI"}` })),
      verified,
    );
    const payload = items.map((i) => ({
      requirement_id: i.requirementId,
      assessment: i.assessment,
      rationale: i.rationale,
      ...(i.cvAssessment ? { cv_assessment: i.cvAssessment } : {}),
      // El cliente envía cv_rationale en todos; solo cuenta donde hay verificación.
      cv_rationale: i.cvRationale ?? "Motivo que no debe guardarse",
    }));
    const { id } = await record(items, payload);
    const { rows } = await db.query<{ requirement_id: string; cv_rationale: string | null }>(
      "select requirement_id, cv_rationale from public.candidate_evaluation_items where evaluation_id = $1",
      [id],
    );
    const byRequirement = new Map(rows.map((r) => [r.requirement_id, r.cv_rationale]));
    expect(byRequirement.get(ids.ingles)).toBe("Motivo de inglés");
    expect(byRequirement.get(ids.sql)).toHaveLength(2000);
    expect(byRequirement.get(ids.deseable)).toBeNull();
  });

  it("la columna no admite más de 2000 caracteres", async () => {
    await expectError(
      db.query("update public.candidate_evaluation_items set cv_rationale = $1 where id = (select id from public.candidate_evaluation_items limit 1)", ["x".repeat(2001)]),
    );
  });
});
