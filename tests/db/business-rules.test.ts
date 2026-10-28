import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addRequirement,
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

let db: PGlite;
let rrhh: string;

beforeAll(async () => {
  db = await createTestDatabase();
  rrhh = await createUser(db, "rrhh", "RRHH Ficticio");
});

/** Usuario con la cuenta desactivada (sin acceso a nada). */
async function createInactiveUser(): Promise<string> {
  const id = await createUser(db, "rrhh");
  await db.query("update public.profiles set is_active = false where id = $1", [id]);
  return id;
}

afterAll(async () => {
  await db?.close();
});

function registerResume(candidateId: string, overrides: { method?: string } = {}) {
  return db.query<{ version: number }>(
    `select public.register_resume(gen_random_uuid(), $1::uuid, 'candidates/' || $1::text || '/' || gen_random_uuid() || '.pdf',
       'cv.pdf', 'application/pdf', 1000, encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
       'completada', $2, 'extractor-v1', 'Texto ficticio del CV', '{}'::jsonb, '{}', null) as version`,
    [candidateId, overrides.method ?? "pdf_text"],
  );
}

type Item = { requirement_id: string; assessment: string; evidence?: unknown[]; rationale?: string };

function recordEvaluation(
  applicationId: string,
  criteriaVersion: number,
  scores: { score: number; potential: number; coverage: number },
  items: Item[],
  level = "parcial",
) {
  return db.query<{ id: string }>(
    `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v1', 'v1', null, $3, $4, $5,
       $7::public.compatibility_level, 'Resumen ficticio', array['Limitación de prueba'], null, $6::jsonb) as id`,
    [applicationId, criteriaVersion, scores.score, scores.potential, scores.coverage, JSON.stringify(items), level],
  );
}

describe("criterios de evaluación", () => {
  it("al aprobar se incrementa la versión y cualquier cambio de requisitos anula la aprobación", async () => {
    const vacancyId = await createVacancy(db);
    await addRequirement(db, vacancyId, { description: "Excel avanzado", weight: 2 });

    const version = await asActor(db, user(rrhh), async () => {
      const { rows } = await db.query<{ v: number }>("select public.approve_vacancy_criteria($1) as v", [
        vacancyId,
      ]);
      return rows[0]!.v;
    });
    expect(version).toBe(1);

    const again = await asActor(db, user(rrhh), () =>
      expectError(db.query("select public.approve_vacancy_criteria($1)", [vacancyId])),
    );
    expect(again.message).toMatch(/ya están aprobados/);

    await asActor(db, user(rrhh), () =>
      db.query(
        `insert into public.vacancy_requirements (vacancy_id, category, priority, description, weight)
         values ($1, 'herramienta', 'deseable', 'Power BI', 1)`,
        [vacancyId],
      ),
    );
    const { rows } = await db.query<{ criteria_approved_at: string | null; criteria_version: number }>(
      "select criteria_approved_at, criteria_version from public.vacancies where id = $1",
      [vacancyId],
    );
    expect(rows[0]!.criteria_approved_at).toBeNull();
    expect(rows[0]!.criteria_version).toBe(1);
  });

  it("RRHH no puede aprobar criterios modificando columnas directamente", async () => {
    const vacancyId = await createVacancy(db);
    const error = await asActor(db, user(rrhh), () =>
      expectError(
        db.query("update public.vacancies set criteria_approved_at = now() where id = $1", [vacancyId]),
      ),
    );
    expect(error.message).toMatch(/permission denied/);
  });
});

describe("registro de evaluaciones", () => {
  let vacancyId: string;
  let applicationId: string;
  let reqSql: string;
  let reqExcel: string;
  let reqIngles: string;
  let version: number;

  beforeAll(async () => {
    vacancyId = await createVacancy(db, { title: "Analista BI" });
    reqSql = await addRequirement(db, vacancyId, { description: "SQL", weight: 5 });
    reqExcel = await addRequirement(db, vacancyId, { description: "Excel", weight: 3, priority: "deseable" });
    reqIngles = await addRequirement(db, vacancyId, { description: "Inglés intermedio", weight: 2 });
    version = await approveCriteria(db, vacancyId);
    applicationId = await createApplication(db, await createCandidate(db), vacancyId);
  });

  it("registra la evaluación con ítems, la vincula a la versión de criterios y no cambia el estado del proceso", async () => {
    // SQL acreditado (5), Excel sin evidencia (3), Inglés no cumplido (2) -> total 10
    const { rows } = await asActor(db, user(rrhh), () =>
      recordEvaluation(applicationId, version, { score: 50, potential: 80, coverage: 70 }, [
        { requirement_id: reqSql, assessment: "acreditado", evidence: [{ quote: "SQL Server" }] },
        { requirement_id: reqExcel, assessment: "sin_evidencia" },
        { requirement_id: reqIngles, assessment: "no_cumplido" },
      ]),
    );
    const evaluationId = rows[0]!.id;

    const evaluation = await db.query<{ criteria_version: number; score: string; review_status: string }>(
      "select criteria_version, score, review_status from public.candidate_evaluations where id = $1",
      [evaluationId],
    );
    expect(evaluation.rows[0]).toEqual({ criteria_version: version, score: "50.00", review_status: "pendiente_revision" });

    const items = await db.query<{ description: string; weight: number; assessment: string }>(
      "select description, weight, assessment from public.candidate_evaluation_items where evaluation_id = $1 order by weight desc",
      [evaluationId],
    );
    expect(items.rows).toEqual([
      { description: "SQL", weight: 5, assessment: "acreditado" },
      { description: "Excel", weight: 3, assessment: "sin_evidencia" },
      { description: "Inglés intermedio", weight: 2, assessment: "no_cumplido" },
    ]);

    const application = await db.query<{ status: string; latest_evaluation_id: string }>(
      "select status, latest_evaluation_id from public.applications where id = $1",
      [applicationId],
    );
    expect(application.rows[0]).toEqual({ status: "nuevo", latest_evaluation_id: evaluationId });
  });

  it("rechaza porcentajes que no coinciden con los pesos almacenados", async () => {
    const error = await asActor(db, user(rrhh), () =>
      expectError(
        recordEvaluation(applicationId, version, { score: 90, potential: 90, coverage: 90 }, [
          { requirement_id: reqSql, assessment: "acreditado" },
          { requirement_id: reqExcel, assessment: "sin_evidencia" },
          { requirement_id: reqIngles, assessment: "no_cumplido" },
        ]),
      ),
    );
    expect(error.message).toMatch(/no coinciden con la metodología/);
  });

  it("exige evaluar exactamente los requisitos vigentes", async () => {
    const error = await asActor(db, user(rrhh), () =>
      expectError(
        recordEvaluation(applicationId, version, { score: 100, potential: 100, coverage: 100 }, [
          { requirement_id: reqSql, assessment: "acreditado" },
        ]),
      ),
    );
    expect(error.message).toMatch(/exactamente los requisitos vigentes/);
  });

  it("rechaza versiones de criterios desactualizadas o criterios no aprobados", async () => {
    const stale = await asActor(db, user(rrhh), () =>
      expectError(
        recordEvaluation(applicationId, version + 1, { score: 50, potential: 80, coverage: 70 }, [
          { requirement_id: reqSql, assessment: "acreditado" },
          { requirement_id: reqExcel, assessment: "sin_evidencia" },
          { requirement_id: reqIngles, assessment: "no_cumplido" },
        ]),
      ),
    );
    expect(stale.message).toMatch(/no coincide con la vigente/);

    await db.query("update public.vacancy_requirements set weight = 4 where id = $1", [reqExcel]);
    const unapproved = await asActor(db, user(rrhh), () =>
      expectError(
        recordEvaluation(applicationId, version, { score: 50, potential: 80, coverage: 70 }, [
          { requirement_id: reqSql, assessment: "acreditado" },
          { requirement_id: reqExcel, assessment: "sin_evidencia" },
          { requirement_id: reqIngles, assessment: "no_cumplido" },
        ]),
      ),
    );
    expect(unapproved.message).toMatch(/no están aprobados/);
  });

  it("las evaluaciones son inmutables; la revisión humana queda registrada", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.candidate_evaluations where application_id = $1",
      [applicationId],
    );
    const evaluationId = rows[0]!.id;

    const missingNotes = await asActor(db, user(rrhh), () =>
      expectError(db.query("select public.review_evaluation($1, 'con_observaciones', '')", [evaluationId])),
    );
    expect(missingNotes.message).toMatch(/observaciones/);

    await asActor(db, user(rrhh), () =>
      db.query("select public.review_evaluation($1, 'con_observaciones', 'Verificar inglés en entrevista')", [
        evaluationId,
      ]),
    );
    const reviewed = await db.query<{ review_status: string; reviewed_by: string }>(
      "select review_status, reviewed_by from public.candidate_evaluations where id = $1",
      [evaluationId],
    );
    expect(reviewed.rows[0]).toEqual({ review_status: "revisada", reviewed_by: rrhh });

    const tamper = await asActor(db, user(rrhh), () =>
      expectError(db.query("update public.candidate_evaluations set score = 100 where id = $1", [evaluationId])),
    );
    expect(tamper.message).toMatch(/permission denied/);
  });
});

describe("estados del proceso", () => {
  it("registra estado anterior, nuevo, responsable y motivo", async () => {
    const vacancyId = await createVacancy(db);
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);

    await asActor(db, user(rrhh), () =>
      db.query("select public.change_application_status($1, 'preseleccionado', null, 'Perfil alineado')", [
        applicationId,
      ]),
    );

    const missingReason = await asActor(db, user(rrhh), () =>
      expectError(db.query("select public.change_application_status($1, 'no_seleccionado')", [applicationId])),
    );
    expect(missingReason.message).toMatch(/motivo/);

    const sameStatus = await asActor(db, user(rrhh), () =>
      expectError(db.query("select public.change_application_status($1, 'preseleccionado')", [applicationId])),
    );
    expect(sameStatus.message).toMatch(/ya se encuentra/);

    const { rows } = await db.query<{
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      actor_id: string | null;
      note: string | null;
    }>(
      "select event_type, from_status, to_status, actor_id, note from public.application_events where application_id = $1 order by id",
      [applicationId],
    );
    expect(rows).toEqual([
      { event_type: "postulacion_creada", from_status: null, to_status: "nuevo", actor_id: null, note: null },
      {
        event_type: "cambio_estado",
        from_status: "nuevo",
        to_status: "preseleccionado",
        actor_id: rrhh,
        note: "Perfil alineado",
      },
    ]);
  });

  it("no admite postulaciones en vacantes cerradas o archivadas", async () => {
    const closed = await createVacancy(db, { status: "cerrada" });
    const candidateId = await createCandidate(db);
    const error = await asActor(db, user(rrhh), () =>
      expectError(
        db.query("insert into public.applications (candidate_id, vacancy_id) values ($1, $2)", [candidateId, closed]),
      ),
    );
    expect(error.message).toMatch(/no admite nuevas postulaciones/);
  });

  it("un candidato solo puede estar en proceso en una vacante a la vez", async () => {
    const first = await createVacancy(db, { title: "Vacante en curso" });
    const second = await createVacancy(db, { title: "Otra vacante" });
    const candidateId = await createCandidate(db);
    const firstApplication = await createApplication(db, candidateId, first);

    const apply = () =>
      asActor(db, user(rrhh), () =>
        db.query<{ id: string }>(
          "insert into public.applications (candidate_id, vacancy_id) values ($1, $2) returning id",
          [candidateId, second],
        ),
      );
    const changeStatus = (applicationId: string, status: string, reason: string | null = null) =>
      asActor(db, user(rrhh), () =>
        db.query("select public.change_application_status($1, $2::public.application_status, $3)", [
          applicationId,
          status,
          reason,
        ]),
      );

    const blocked = await expectError(apply());
    expect(blocked.message).toMatch(/ya está en proceso en la vacante «Vacante en curso»/);

    // Al terminar el proceso puede postular a otra vacante...
    await changeStatus(firstApplication, "no_seleccionado", "Perfil distinto");
    const { rows } = await apply();
    const secondApplication = rows[0]!.id;

    // ...pero la primera no se puede reabrir mientras la segunda siga en proceso.
    const reopen = await expectError(changeStatus(firstApplication, "en_revision"));
    expect(reopen.message).toMatch(/ya está en proceso en la vacante «Otra vacante»/);

    await changeStatus(secondApplication, "en_reserva");
    await changeStatus(firstApplication, "en_revision");
  });

  it("una vacante archivada deja de contar como proceso en curso", async () => {
    const archived = await createVacancy(db);
    const candidateId = await createCandidate(db);
    await createApplication(db, candidateId, archived);
    await db.query("update public.vacancies set status = 'archivada' where id = $1", [archived]);
    const open = await createVacancy(db);

    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ id: string }>(
        "insert into public.applications (candidate_id, vacancy_id) values ($1, $2) returning id",
        [candidateId, open],
      ),
    );
    expect(rows).toHaveLength(1);

    const overview = await db.query<{ vacancy_status: string }>(
      "select vacancy_status from public.application_overview where candidate_id = $1 order by applied_at",
      [candidateId],
    );
    expect(overview.rows.map((row) => row.vacancy_status)).toEqual(["archivada", "publicada"]);
  });

  it("los casos en proceso previos a la regla pueden seguir avanzando", async () => {
    const candidateId = await createCandidate(db);
    await db.exec("alter table public.applications disable trigger applications_one_in_process");
    const legacy = await createApplication(db, candidateId, await createVacancy(db));
    await createApplication(db, candidateId, await createVacancy(db));
    await db.exec("alter table public.applications enable trigger applications_one_in_process");

    await asActor(db, user(rrhh), () =>
      db.query("select public.change_application_status($1, 'en_revision')", [legacy]),
    );
    const { rows } = await db.query<{ status: string }>("select status from public.applications where id = $1", [legacy]);
    expect(rows[0]!.status).toBe("en_revision");
  });

  it("una vacante con postulaciones no puede eliminarse", async () => {
    const vacancyId = await createVacancy(db, { status: "borrador" });
    await createApplication(db, await createCandidate(db), vacancyId);
    const error = await expectError(db.query("delete from public.vacancies where id = $1", [vacancyId]));
    expect(error.message).toMatch(/foreign key/);
  });
});

describe("candidatos y CV", () => {
  it("versiona los CV y mantiene uno vigente (registro atómico con su extracción)", async () => {
    const candidateId = await createCandidate(db);
    const versions: number[] = [];
    for (let i = 0; i < 2; i++) {
      const { rows } = await asActor(db, user(rrhh), () => registerResume(candidateId));
      versions.push(rows[0]!.version);
    }
    expect(versions).toEqual([1, 2]);
    const { rows } = await db.query<{ version: number; is_current: boolean; uploaded_by: string; extraction: string }>(
      `select r.version, r.is_current, r.uploaded_by, e.status as extraction
         from public.resumes r join public.resume_extractions e on e.resume_id = r.id
        where r.candidate_id = $1 order by r.version`,
      [candidateId],
    );
    expect(rows).toEqual([
      { version: 1, is_current: false, uploaded_by: rrhh, extraction: "completada" },
      { version: 2, is_current: true, uploaded_by: rrhh, extraction: "completada" },
    ]);
  });

  it("si la extracción no puede registrarse, tampoco queda el CV (sin versiones vigentes sin texto)", async () => {
    const candidateId = await createCandidate(db);
    const error = await asActor(db, user(rrhh), () => expectError(registerResume(candidateId, { method: "ocr_invalido" })));
    expect(error.message).toMatch(/resume_extractions_method_check/);
    const { rows } = await db.query("select id from public.resumes where candidate_id = $1", [candidateId]);
    expect(rows).toEqual([]);
  });

  it("no permite rutas de almacenamiento fuera de la carpeta del candidato", async () => {
    const candidateId = await createCandidate(db);
    const error = await expectError(
      db.query(
        `insert into public.resumes (candidate_id, storage_path, original_filename, mime_type, size_bytes, sha256)
         values ($1, 'candidates/otro/cv.pdf', 'cv.pdf', 'application/pdf', 10, repeat('c', 64))`,
        [candidateId],
      ),
    );
    expect(error.message).toMatch(/resumes_storage_path_check/);
  });

  it("detecta posibles duplicados por correo, teléfono o nombre normalizado", async () => {
    await db.query(
      "insert into public.candidates (full_name, email, phone) values ('José Ñúñez Ficticio', 'Jose.Nunez@Correo.test', '+51 987 654 321')",
    );
    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ full_name: string; match_reasons: string[] }>(
        "select full_name, match_reasons from public.find_candidate_duplicates($1, $2, $3)",
        ["jose.nunez@correo.test ", "987654321", "jose  nunez FICTICIO"],
      ),
    );
    expect(rows).toEqual([{ full_name: "José Ñúñez Ficticio", match_reasons: ["correo", "telefono", "nombre"] }]);
  });

  it("marca la verificación humana de datos del perfil profesional", async () => {
    const candidateId = await createCandidate(db);
    const { rows } = await asActor(db, user(rrhh), () =>
      db.query<{ verified_by: string | null; origin: string }>(
        `insert into public.candidate_profile_items (candidate_id, kind, title, origin)
         values ($1, 'certificacion', 'Scrum Master', 'verificado') returning verified_by, origin`,
        [candidateId],
      ),
    );
    expect(rows[0]).toEqual({ verified_by: rrhh, origin: "verificado" });
  });
});

describe("panel y límites", () => {
  it("una cuenta desactivada ve el panel vacío", async () => {
    await createApplication(db, await createCandidate(db), await createVacancy(db));
    const summary = await asActor(db, user(await createInactiveUser()), async () => {
      const { rows } = await db.query<{ s: { active_vacancies: number; candidates_per_vacancy: unknown[] } }>(
        "select public.get_dashboard_summary() as s",
      );
      return rows[0]!.s;
    });
    expect(summary.active_vacancies).toBe(0);
    expect(summary.candidates_per_vacancy).toHaveLength(0);
  });

  it("el límite de solicitudes bloquea tras superar el máximo definido en la base de datos", async () => {
    const results = await asActor(db, user(rrhh), async () => {
      const values: boolean[] = [];
      for (let i = 0; i < 21; i++) {
        const { rows } = await db.query<{ ok: boolean }>("select public.consume_rate_limit('cv_upload') as ok");
        values.push(rows[0]!.ok);
      }
      return values;
    });
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
  });

  it("quien llama no puede elegir el máximo ni la ventana, ni inventar operaciones", async () => {
    await asActor(db, user(rrhh), async () => {
      const custom = await expectError(db.query("select public.consume_rate_limit('cv_upload', 1000000, 1)"));
      expect(custom.message).toMatch(/does not exist/);
      const unknown = await expectError(db.query("select public.consume_rate_limit('cualquier_cosa')"));
      expect(unknown.message).toMatch(/desconocido/);
    });
  });
});

describe("regresiones de la revisión de seguridad", () => {
  it("una evaluación solo se revisa una vez: no se pierden observaciones previas", async () => {
    const vacancyId = await createVacancy(db);
    const requirementId = await addRequirement(db, vacancyId, { description: "SQL", weight: 2 });
    const version = await approveCriteria(db, vacancyId);
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    const { rows } = await asActor(db, user(rrhh), () =>
      recordEvaluation(applicationId, version, { score: 0, potential: 100, coverage: 0 }, [
        { requirement_id: requirementId, assessment: "sin_evidencia" },
      ], "pendiente"),
    );
    const evaluationId = rows[0]!.id;
    await asActor(db, user(rrhh), () =>
      db.query("select public.review_evaluation($1, 'requiere_reevaluacion', 'Revisar SQL en entrevista')", [evaluationId]),
    );
    const second = await asActor(db, user(rrhh), () =>
      expectError(db.query("select public.review_evaluation($1, 'conforme', '')", [evaluationId])),
    );
    expect(second.message).toMatch(/ya fue revisada/);
    const stored = await db.query<{ review_notes: string }>(
      "select review_notes from public.candidate_evaluations where id = $1",
      [evaluationId],
    );
    expect(stored.rows[0]!.review_notes).toBe("Revisar SQL en entrevista");
  });

  it("rechaza un nivel de compatibilidad que no corresponde a la metodología", async () => {
    const vacancyId = await createVacancy(db);
    const requirementId = await addRequirement(db, vacancyId, { description: "Colegiatura", weight: 3 });
    const version = await approveCriteria(db, vacancyId);
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    const error = await asActor(db, user(rrhh), () =>
      expectError(
        db.query(
          `select public.record_evaluation($1, null, $2, 'reglas', 'reglas-v1', 'v1', null, 0, 0, 100,
             'alta', 'Todo bien', '{}', null, $3::jsonb)`,
          [applicationId, version, JSON.stringify([{ requirement_id: requirementId, assessment: "no_cumplido" }])],
        ),
      ),
    );
    expect(error.message).toMatch(/nivel no coincide/);
  });

  it("aplica el ciclo de vida de la vacante también en la base de datos", async () => {
    const archived = await createVacancy(db, { status: "archivada" });
    await asActor(db, user(rrhh), async () => {
      const reopen = await expectError(
        db.query("update public.vacancies set status = 'publicada' where id = $1", [archived]),
      );
      expect(reopen.message).toMatch(/no está permitido/);
      const created = await expectError(
        db.query("insert into public.vacancies (title, department, status) values ('Directa', 'Área', 'publicada')"),
      );
      expect(created.message).toMatch(/se crean en borrador/);
      const approve = await expectError(db.query("select public.approve_vacancy_criteria($1)", [archived]));
      expect(approve.message).toMatch(/archivada/);
    });
  });

  it("no cambia estados de postulaciones de vacantes archivadas", async () => {
    const vacancyId = await createVacancy(db);
    const applicationId = await createApplication(db, await createCandidate(db), vacancyId);
    await db.query("update public.vacancies set status = 'archivada' where id = $1", [vacancyId]);
    const error = await asActor(db, user(rrhh), () =>
      expectError(db.query("select public.change_application_status($1, 'en_revision')", [applicationId])),
    );
    expect(error.message).toMatch(/archivada/);
  });

  it("nadie elimina postulaciones (se conserva su historial)", async () => {
    const admin = await createUser(db, "admin");
    const applicationId = await createApplication(db, await createCandidate(db), await createVacancy(db));
    const error = await asActor(db, user(admin), () =>
      expectError(db.query("delete from public.applications where id = $1", [applicationId])),
    );
    expect(error.message).toMatch(/permission denied/);
  });

  it("solo se pide opinión a personas con la cuenta activa", async () => {
    const applicationId = await createApplication(db, await createCandidate(db), await createVacancy(db));
    const ask = (profileId: string) =>
      asActor(db, user(rrhh), () => db.query("select public.request_opinion($1, $2)", [applicationId, profileId]));
    const error = await expectError(ask(await createInactiveUser()));
    expect(error.message).toMatch(/cuenta activa/);
    const colleague = await createUser(db, "rrhh");
    await ask(colleague);
    const { rows } = await db.query<{ assigned_evaluator_id: string }>(
      "select assigned_evaluator_id from public.applications where id = $1",
      [applicationId],
    );
    expect(rows[0]!.assigned_evaluator_id).toBe(colleague);
  });

  it("un dato del perfil no puede vincularse al CV de otro candidato", async () => {
    const owner = await createCandidate(db);
    const other = await createCandidate(db);
    const { rows } = await asActor(db, user(rrhh), () => registerResume(other));
    expect(rows[0]!.version).toBe(1);
    const otherResume = await db.query<{ id: string }>("select id from public.resumes where candidate_id = $1", [other]);
    const error = await asActor(db, user(rrhh), () =>
      expectError(
        db.query(
          "insert into public.candidate_profile_items (candidate_id, kind, title, origin, source_resume_id) values ($1, 'habilidad', 'SQL', 'extraido', $2)",
          [owner, otherResume.rows[0]!.id],
        ),
      ),
    );
    expect(error.message).toMatch(/candidate_profile_items_resume_fk/);
  });

  it("la auditoría de descargas solo admite CV accesibles y no acepta datos arbitrarios", async () => {
    const vacancyId = await createVacancy(db);
    const candidateId = await createCandidate(db);
    await createApplication(db, candidateId, vacancyId);
    await asActor(db, user(rrhh), () => registerResume(candidateId));
    const resume = await db.query<{ id: string }>("select id from public.resumes where candidate_id = $1", [candidateId]);
    const resumeId = resume.rows[0]!.id;

    const denied = await asActor(db, user(await createInactiveUser()), () =>
      expectError(db.query("select public.log_resume_download($1)", [resumeId])),
    );
    expect(denied.message).toMatch(/No autorizado/);

    const generic = await asActor(db, user(rrhh), () =>
      expectError(db.query("select public.log_audit_event('update', 'candidates', 'x', '{}')")),
    );
    expect(generic.message).toMatch(/does not exist/);

    await asActor(db, user(rrhh), () => db.query("select public.log_resume_download($1)", [resumeId]));
    const { rows } = await db.query<{ actor_id: string; metadata: Record<string, string> }>(
      "select actor_id, metadata from public.audit_logs where action = 'cv_descargado' and entity_id = $1",
      [resumeId],
    );
    expect(rows).toEqual([{ actor_id: rrhh, metadata: { candidate_id: candidateId } }]);
  });
});
