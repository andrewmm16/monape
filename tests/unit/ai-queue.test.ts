import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequirementInput } from "@/modules/evaluation/types";

const SECRET = "secreto-ficticio-del-worker-0123456789abcdef";
const JOB = "7d4c2a10-5b3e-4f6a-9c1d-2e3f4a5b6c7d";
const APP = "1a2b3c4d-1111-4222-8333-444455556666";
const R1 = "0f0f0f0f-aaaa-4bbb-8ccc-000000000001";
const R2 = "0f0f0f0f-aaaa-4bbb-8ccc-000000000002";
const TOKEN = "9e8d7c6b-1234-4abc-8def-0123456789ab";
const OTHER_TOKEN = "9e8d7c6b-1234-4abc-8def-ffffffffffff";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  rpc: vi.fn(),
  job: null as Record<string, unknown> | null,
  load: vi.fn(),
  admins: [] as { email: string | null }[],
  sendEmail: vi.fn(),
  /** Regla aprendida reservada para el segundo juez (tabla learned_equivalences), o null. */
  judgment: null as Record<string, unknown> | null,
  recordAssembled: vi.fn(),
  /** Filas insertadas con el cliente de administración (vigilancia semanal). */
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  /** Trabajo de preguntas para profundizar reservado (tabla interview_deep_dives), o null. */
  deepDive: null as Record<string, unknown> | null,
  /** Postulación leída por el worker de preguntas. */
  application: null as Record<string, unknown> | null,
  /** Ítems de la guía por postulación (loadGuideItems). */
  guideItems: new Map<string, unknown>(),
}));

vi.mock("@/lib/env", () => ({ getServerEnv: () => mocks.env }));
vi.mock("@/modules/notifications/email/client", () => ({ sendEmail: (...args: unknown[]) => mocks.sendEmail(...args) }));
vi.mock("@/modules/evaluation/service", () => ({
  listVerifications: async () => [],
  recordAssembledEvaluation: (...args: unknown[]) => mocks.recordAssembled(...args),
}));
vi.mock("@/modules/evaluation/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/evaluation/context")>()),
  loadEvaluationContext: (...args: unknown[]) => mocks.load(...args),
}));
vi.mock("@/modules/evaluation/interview-guide-data", () => ({
  loadGuideItems: async () => mocks.guideItems,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.in = () => chain;
      chain.insert = async (row: Record<string, unknown>) => {
        mocks.inserts.push({ table, row });
        return { error: null };
      };
      chain.maybeSingle = async () => ({
        data:
          table === "learned_equivalences"
            ? mocks.judgment
            : table === "interview_deep_dives"
              ? mocks.deepDive
              : table === "applications"
                ? mocks.application
                : mocks.job,
        error: null,
      });
      // Reglas aprendidas activas: ninguna en estas pruebas.
      if (table === "learned_equivalences") chain.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
      // Lista de administradores (alertas): la consulta se espera directamente.
      if (table === "profiles") chain.then = (resolve: (value: unknown) => void) => resolve({ data: mocks.admins, error: null });
      return chain;
    },
  }),
}));

import { AI_WORKER_OFFLINE_MS, autoEnqueueDeepDive, describeAiJob, describeAiJobError, describeAiWorker } from "@/modules/evaluation/ai-queue";
import { claimAiJob, reportAiJob, reportAiQualityCheck, reportAiWorkerStatus } from "@/modules/evaluation/ai-worker-api";
import { getAiAvailability } from "@/modules/evaluation/ai/availability";
import { isDoubtful } from "@/modules/evaluation/ai/doubtful";
import { AI_OUTPUT_JSON_SCHEMA, buildAiInput } from "@/modules/evaluation/ai/input";
import { DEEP_DIVE_JSON_SCHEMA } from "@/modules/evaluation/ai/deep-dive-prompt";
import type { GuideItemInput } from "@/modules/evaluation/interview-guide";
import { PROMPT_VERSION } from "@/modules/evaluation/ai/prompt";
import { RULE_ENGINE_VERSION } from "@/modules/evaluation/rule-engine";
import { ResumeTextUnavailableError } from "@/modules/evaluation/context";

const requirements: RequirementInput[] = [
  { id: R1, category: "habilidad_tecnica", priority: "obligatorio", description: "Excel avanzado", keywords: [], weight: 5, minYears: null, isEssential: false },
  { id: R2, category: "idioma", priority: "deseable", description: "Inglés intermedio", keywords: [], weight: 3, minYears: null, isEssential: false },
];
const CV = "Analista con Excel avanzado y tablas dinámicas. Contacto: ana.ficticia@correo.test. Experiencia 2019 - 2023 en finanzas.";

const context = () => ({
  applicationId: APP,
  candidateId: "cand-1",
  vacancyTitle: "Analista de datos",
  vacancyText: "Analizar datos de ventas y preparar reportes para la gerencia comercial.",
  criteriaVersion: 2,
  requirements,
  resumeId: "res-1",
  fullText: CV,
  textWasCorrected: false,
});

const sentSha = () => buildAiInput({ vacancyTitle: "Analista de datos", requirements, fullText: CV, maxChars: 30_000 }).inputSha256;

const validOutput = {
  items: [
    { requirement_id: R1, assessment: "acreditado", evidence_quotes: ["Excel avanzado"], rationale: "Lo declara." },
    { requirement_id: R2, assessment: "sin_evidencia", evidence_quotes: [], rationale: "No lo menciona." },
  ],
};

function req(url: string, json?: unknown, token: string | null = SECRET) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: json === undefined ? "{}" : JSON.stringify(json),
  });
}

const rpcCalls = (name: string) => mocks.rpc.mock.calls.filter(([n]) => n === name).map(([, args]) => args);

beforeEach(() => {
  mocks.env = {
    AI_PROVIDER: "claude-cli",
    AI_MODEL: "claude-opus-5-5",
    AI_EXTERNAL_PROCESSING_APPROVED: true,
    AI_WORKER_SECRET: SECRET,
    AI_MAX_INPUT_CHARS: 30_000,
  };
  mocks.job = null;
  mocks.judgment = null;
  mocks.deepDive = null;
  mocks.application = null;
  mocks.guideItems = new Map();
  mocks.recordAssembled.mockReset().mockResolvedValue("eval-reglas-relevo");
  mocks.admins = [];
  mocks.inserts = [];
  mocks.sendEmail.mockReset().mockResolvedValue({ sent: true });
  mocks.load.mockReset().mockResolvedValue(context());
  mocks.rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "ai_worker_heartbeat") return { data: false, error: null };
    if (name === "ai_claim_job") return { data: [], error: null };
    if (name === "ai_release_job") return { data: "pendiente", error: null };
    if (name === "ai_complete_job") return { data: "eval-ia-1", error: null };
    return { data: null, error: null };
  });
});

describe("caso dudoso", () => {
  const scores = (score: number, potential = score) => ({ score, potential, coverage: 100, unknown: 0, notMet: 100 - potential });
  const item = (requirementId: string, assessment: "acreditado" | "no_cumplido" | "sin_evidencia") => ({
    requirementId,
    assessment,
    evidence: [],
    rationale: "",
  });

  // Desde el 18/11/2026 el nivel, la cercanía a un corte o lo que falta confirmar ya no
  // bastan: mandaban el 75 % de los CV a la IA y casi nunca cambiaba algo. Solo lo que la
  // IA puede resolver (dudas concretas del motor, relleno) y la muestra de control.
  it("el nivel, la cercanía a un corte o lo que falta confirmar ya no bastan solos", () => {
    expect(isDoubtful({ level: "pendiente", scores: scores(0, 100), items: [] }, requirements)).toBe(false);
    expect(isDoubtful({ level: "parcial", scores: scores(55), items: [] }, requirements)).toBe(false);
    expect(isDoubtful({ level: "alta", scores: scores(75), items: [] }, requirements)).toBe(false);
    expect(isDoubtful({ level: "alta", scores: scores(85), items: [item(R1, "acreditado")] }, requirements)).toBe(false);
  });

  it("una duda concreta del motor o el relleno de palabras clave sí", () => {
    expect(isDoubtful({ level: "parcial", scores: scores(55), items: [] }, requirements, { engineItems: [{ signal: "mencion_dudosa" }] })).toBe(true);
    expect(isDoubtful({ level: "alta", scores: scores(90), items: [] }, requirements, { suspiciousText: true })).toBe(true);
  });

  it("un bajo con un obligatorio no cumplido es dudoso (descarte a confirmar)", () => {
    expect(isDoubtful({ level: "baja", scores: scores(10, 20), items: [item(R1, "no_cumplido")] }, requirements)).toBe(true);
    expect(isDoubtful({ level: "baja", scores: scores(10, 20), items: [item(R2, "no_cumplido")] }, requirements)).toBe(false);
  });
});

describe("entrada al modelo", () => {
  it("reemplaza datos de contacto, conserva años y calcula la huella del texto enviado", () => {
    const input = buildAiInput({ vacancyTitle: "Analista", requirements, fullText: CV, maxChars: 30_000 });
    expect(input.evaluatedText).not.toContain("ana.ficticia@correo.test");
    expect(input.evaluatedText).toContain("2019 - 2023");
    expect(input.userMessage).toContain(R1);
    expect(input.inputSha256).toBe(createHash("sha256").update(input.evaluatedText).digest("hex"));
    expect(input.textTruncated).toBe(false);
  });

  it("el esquema para el CLI no lleva $schema (el CLI rechaza la meta-referencia draft 2020-12)", () => {
    expect(AI_OUTPUT_JSON_SCHEMA).not.toHaveProperty("$schema");
    expect(AI_OUTPUT_JSON_SCHEMA).toMatchObject({ type: "object", required: ["items"] });
  });

  it("recorta el texto al máximo y lo indica", () => {
    const input = buildAiInput({ vacancyTitle: "Analista", requirements, fullText: "x".repeat(2_000), maxChars: 1_000 });
    expect(input.evaluatedText).toHaveLength(1_000);
    expect(input.textTruncated).toBe(true);
  });
});

describe("disponibilidad con la cola", () => {
  const base = { AI_PROVIDER: "claude-cli" as const, AI_MODEL: "m", AI_EXTERNAL_PROCESSING_APPROVED: true };

  it("requiere aprobación de la empresa y el secreto del worker, no la clave de la API", () => {
    expect(getAiAvailability({ ...base, AI_EXTERNAL_PROCESSING_APPROVED: false }).available).toBe(false);
    expect(getAiAvailability(base)).toMatchObject({ available: false, reason: expect.stringMatching(/secreto del worker/) });
    expect(getAiAvailability({ ...base, AI_WORKER_SECRET: SECRET })).toEqual({
      available: true,
      provider: "claude-cli",
      model: "m",
      queued: true,
    });
  });

  it("la API de pago sigue siendo directa", () => {
    expect(getAiAvailability({ ...base, AI_PROVIDER: "anthropic", AI_API_KEY: "k" })).toMatchObject({ queued: false });
  });
});

describe("estado visible para RRHH", () => {
  const job = (overrides: Record<string, unknown>) =>
    ({
      id: JOB,
      status: "pendiente",
      origin: "manual",
      requested_at: "2026-11-16T10:00:00Z",
      available_at: "2026-11-16T15:00:00Z",
      attempts: 0,
      error_code: null,
      finished_at: null,
      ...overrides,
    }) as Parameters<typeof describeAiJob>[0];
  const fmt = (iso: string) => `[${iso}]`;

  it("informa la cola, el procesamiento, la espera por límite y el error", () => {
    expect(describeAiJob(job({}), fmt)).toMatchObject({ active: true, message: expect.stringContaining("en cola") });
    expect(describeAiJob(job({ status: "procesando" }), fmt)?.message).toMatch(/analizando/);
    expect(describeAiJob(job({ error_code: "limite_plan" }), fmt)).toMatchObject({
      tone: "warning",
      active: true,
      message: expect.stringContaining("[2026-11-16T15:00:00Z]"),
    });
    expect(describeAiJob(job({ status: "error", error_code: "sin_texto" }), fmt)).toMatchObject({
      active: false,
      message: expect.stringContaining("texto legible"),
    });
  });

  it("no muestra nada sin trabajos o con el último completado", () => {
    expect(describeAiJob(null, fmt)).toBeNull();
    expect(describeAiJob(job({ status: "completado" }), fmt)).toBeNull();
  });
});

describe("estado del worker visible para RRHH", () => {
  const NOW = Date.parse("2026-11-16T15:00:00Z");
  const fmt = (iso: string) => `[${iso}]`;
  const status = (overrides: Record<string, unknown> = {}) =>
    ({
      state: "activo",
      pause_reason: null,
      paused_until: null,
      last_seen_at: new Date(NOW - 30_000).toISOString(),
      state_since: "2026-11-16T10:00:00Z",
      ...overrides,
    }) as Parameters<typeof describeAiWorker>[0];

  it("sin aviso si late y está activo", () => {
    expect(describeAiWorker(status(), fmt, NOW)).toBeNull();
  });

  it("avisa si nunca se conectó o dejó de latir", () => {
    expect(describeAiWorker(null, fmt, NOW)).toMatchObject({ needsAdmin: true, message: expect.stringMatching(/no se ha conectado/) });
    const lastSeen = new Date(NOW - AI_WORKER_OFFLINE_MS - 1_000).toISOString();
    expect(describeAiWorker(status({ last_seen_at: lastSeen }), fmt, NOW)).toMatchObject({
      needsAdmin: true,
      message: expect.stringContaining(`no responde desde [${lastSeen}]`),
    });
  });

  it("distingue el límite del plan (se resuelve solo) de la sesión inválida (requiere intervenir)", () => {
    expect(
      describeAiWorker(status({ state: "pausado", pause_reason: "limite_plan", paused_until: "2026-11-16T18:00:00Z" }), fmt, NOW),
    ).toMatchObject({ needsAdmin: false, message: expect.stringContaining("[2026-11-16T18:00:00Z]") });
    expect(describeAiWorker(status({ state: "pausado", pause_reason: "sin_sesion" }), fmt, NOW)).toMatchObject({
      needsAdmin: true,
      message: expect.stringMatching(/renovar su sesión/),
    });
  });
});

describe("API del worker: estado", () => {
  it("registra el latido y, al perder la sesión, avisa una vez a la administración", async () => {
    mocks.admins = [{ email: "admin1@empresa.test" }, { email: null }, { email: "admin2@empresa.test" }];
    mocks.rpc.mockImplementation(async () => ({ data: true, error: null }));
    const response = await reportAiWorkerStatus(req("/api/ia/estado", { state: "pausado", reason: "sin_sesion" }));
    expect(response.status).toBe(200);
    expect(rpcCalls("ai_worker_heartbeat")).toEqual([
      { p_state: "pausado", p_reason: "sin_sesion", p_until: undefined, p_cli_version: undefined },
    ]);
    expect(mocks.sendEmail.mock.calls.map(([input]) => (input as { to: string }).to)).toEqual([
      "admin1@empresa.test",
      "admin2@empresa.test",
    ]);
    expect((mocks.sendEmail.mock.calls[0]![0] as { text: string }).text).toMatch(/claude setup-token/);
  });

  it("no avisa si el estado no cambió ni por el límite del plan", async () => {
    mocks.admins = [{ email: "admin1@empresa.test" }];
    await reportAiWorkerStatus(req("/api/ia/estado", { state: "pausado", reason: "sin_sesion" })); // latido repetido (data: false)
    mocks.rpc.mockImplementation(async () => ({ data: true, error: null }));
    await reportAiWorkerStatus(req("/api/ia/estado", { state: "pausado", reason: "limite_plan" }));
    await reportAiWorkerStatus(req("/api/ia/estado", { state: "activo", cliVersion: "2.1.325" }));
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("valida el cuerpo y exige el secreto", async () => {
    expect((await reportAiWorkerStatus(req("/api/ia/estado", { state: "pausado" }))).status).toBe(422);
    expect((await reportAiWorkerStatus(req("/api/ia/estado", { state: "activo" }, "otro"))).status).toBe(404);
  });

  it("cada reclamo de trabajo cuenta como latido activo", async () => {
    await claimAiJob(req("/api/ia/trabajos/siguiente"));
    expect(rpcCalls("ai_worker_heartbeat")).toEqual([
      { p_state: "activo", p_reason: undefined, p_until: undefined, p_cli_version: undefined },
    ]);
  });
});

describe("API del worker: autorización", () => {
  it("responde 404 sin secreto configurado, sin token o con token incorrecto", async () => {
    for (const token of [null, "otro-token"]) {
      expect((await claimAiJob(req("/api/ia/trabajos/siguiente", {}, token))).status).toBe(404);
      expect((await reportAiJob(req("/x", { outcome: "error", claimToken: TOKEN, errorCode: "x" }, token), JOB)).status).toBe(404);
    }
    mocks.env.AI_WORKER_SECRET = undefined;
    expect((await claimAiJob(req("/api/ia/trabajos/siguiente"))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("API del worker: reclamo", () => {
  it("sin aprobación de la empresa no entrega trabajos", async () => {
    mocks.env.AI_EXTERNAL_PROCESSING_APPROVED = false;
    const response = await claimAiJob(req("/api/ia/trabajos/siguiente"));
    expect(await response.json()).toEqual({ job: null, paused: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("entrega el prompt armado (sin datos de contacto) y guarda la huella del texto enviado", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "ai_claim_job"
        ? { data: [{ job_id: JOB, application_id: APP, attempts: 1, claim_token: TOKEN }], error: null }
        : { data: null, error: null },
    );
    const response = await claimAiJob(req("/api/ia/trabajos/siguiente"));
    const body = (await response.json()) as { job: Record<string, unknown> };

    expect(body.job).toMatchObject({ id: JOB, claimToken: TOKEN, attempt: 1, model: "claude-opus-5-5", effort: "medium" });
    expect(body.job.prompt).toContain("<cv>");
    expect(body.job.prompt).not.toContain("ana.ficticia@correo.test");
    // Las dudas del motor van al prompt (v2): el inglés no aparece en el CV → nota bajo su requisito.
    const prompt = String(body.job.prompt);
    expect(prompt.slice(prompt.indexOf(`id: ${R2}`), prompt.indexOf("<cv>"))).toContain("nota del motor:");
    expect(JSON.stringify(body.job.schema)).toContain("evidence_quotes");
    expect(rpcCalls("ai_start_job")).toEqual([
      { p_job_id: JOB, p_claim_token: TOKEN, p_input_sha256: sentSha(), p_criteria_version: 2 },
    ]);
  });

  it("sin CV en cola, entrega al segundo juez una regla aprendida (con su modelo y a ciegas)", async () => {
    mocks.env.AI_LEARN_MIN_CONFIRMATIONS = 5;
    mocks.env.AI_JUDGE_MODEL = "claude-opus-5-5";
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "learn_claim_judgment"
        ? {
            data: [
              {
                equivalence_id: JOB,
                judge_token: TOKEN,
                attempts: 1,
                requirement_category: "experiencia",
                requirement_description: "Supervisión de obras",
                cv_term_display: "Asistente de Residencia",
                verdict: "equivale",
                votes: 5,
              },
            ],
            error: null,
          }
        : { data: name === "ai_claim_job" ? [] : null, error: null },
    );
    const body = (await (await claimAiJob(req("/api/ia/trabajos/siguiente"))).json()) as { job: Record<string, unknown> };
    expect(body.job).toMatchObject({ id: JOB, claimToken: TOKEN, attempt: 1, model: "claude-opus-5-5" });
    expect(String(body.job.prompt)).toContain("«Asistente de Residencia»");
    expect(String(body.job.prompt)).not.toMatch(/votos|la IA/);

    mocks.env.AI_LEARN_MIN_CONFIRMATIONS = 0; // sin aprendizaje no hay juicios
    expect(await (await claimAiJob(req("/api/ia/trabajos/siguiente"))).json()).toEqual({ job: null });
  });

  it("cierra con error los trabajos sin texto legible y sigue con el siguiente", async () => {
    let claims = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "ai_claim_job") {
        claims++;
        return { data: claims === 1 ? [{ job_id: JOB, application_id: APP, attempts: 1, claim_token: TOKEN }] : [], error: null };
      }
      return { data: "error", error: null };
    });
    mocks.load.mockRejectedValueOnce(new ResumeTextUnavailableError("sin texto"));

    const body = await (await claimAiJob(req("/api/ia/trabajos/siguiente"))).json();
    expect(body).toEqual({ job: null });
    expect(rpcCalls("ai_release_job")).toEqual([
      { p_job_id: JOB, p_claim_token: TOKEN, p_outcome: "error", p_error_code: "sin_texto", p_retry_at: undefined },
    ]);
  });
});

describe("API del worker: resultado", () => {
  const reserved = () => ({
    id: JOB,
    application_id: APP,
    status: "procesando",
    claim_token: TOKEN,
    input_sha256: sentSha(),
    criteria_version: 2,
  });
  const ok = (output: unknown, extra: Record<string, unknown> = {}) =>
    req("/x", { outcome: "ok", claimToken: TOKEN, output, ...extra });

  it("valida la salida, la puntúa con la metodología y registra la evaluación con IA", async () => {
    mocks.job = reserved();
    const response = await reportAiJob(ok(validOutput, { model: "claude-opus-5-5" }), JOB);
    expect(await response.json()).toEqual({ status: "completado", evaluationId: "eval-ia-1" });

    const [args] = rpcCalls("ai_complete_job") as Record<string, unknown>[];
    expect(args).toMatchObject({
      p_job_id: JOB,
      p_claim_token: TOKEN,
      p_resume_id: "res-1",
      p_criteria_version: 2,
      p_method_version: PROMPT_VERSION,
      p_model: "claude-opus-5-5",
      p_score: 62.5,
      p_level: "parcial",
      p_input_sha256: sentSha(),
    });
    expect(args!.p_items).toEqual([
      expect.objectContaining({ requirement_id: R1, assessment: "acreditado", evidence: [{ quote: "Excel avanzado" }] }),
      expect.objectContaining({ requirement_id: R2, assessment: "sin_evidencia" }),
    ]);
  });

  it("tras la IA: el motor la usa en lo que dudó (nueva evaluación del motor, vigente) y registra los votos", async () => {
    mocks.env.AI_RELAY_SCORE = true;
    mocks.env.AI_LEARN_MIN_CONFIRMATIONS = 5;
    mocks.job = reserved();
    const output = {
      items: [
        validOutput.items[0],
        { ...validOutput.items[1], equivalence: { cv_term: "finanzas", equivalent: true } },
      ],
    };
    expect(await (await reportAiJob(ok(output, { model: "claude-haiku-5-5" }), JOB)).json()).toEqual({
      status: "completado",
      evaluationId: "eval-ia-1",
    });

    // Relevo: evaluación del motor (sistema) con la IA en lo dudoso.
    const [, relay] = mocks.recordAssembled.mock.calls[0] as [unknown, { result: { method: string; methodVersion: string; items: { resolvedBy?: string }[] }; system: boolean }];
    expect(relay.system).toBe(true);
    expect(relay.result.method).toBe("reglas");
    expect(relay.result.methodVersion).toBe(`${RULE_ENGINE_VERSION}+${PROMPT_VERSION}`);
    // R1: el motor no pudo (sin términos) y la IA acredita → cuenta. R2: la IA también dice
    // «sin evidencia» → no cambia el puntaje → queda la del motor.
    expect(relay.result.items.map((i) => i.resolvedBy)).toEqual(["ia", undefined]);

    // Voto: el inglés no aparece en el CV (duda de vocabulario) y la IA señaló un término literal.
    expect(rpcCalls("learn_record_vote")).toEqual([
      expect.objectContaining({ p_cv_term: "finanzas", p_candidate_id: "cand-1", p_application_id: APP, p_equivalent: true, p_min_confirmations: 5 }),
    ]);
  });

  it("sin AI_RELAY_SCORE la IA no cuenta en el puntaje (solo se muestra)", async () => {
    mocks.env.AI_RELAY_SCORE = false;
    mocks.job = reserved();
    await reportAiJob(ok(validOutput), JOB);
    expect(mocks.recordAssembled).not.toHaveBeenCalled();
  });

  it("un fallo al registrar el relevo no hace fallar el cierre del trabajo", async () => {
    mocks.env.AI_RELAY_SCORE = true;
    mocks.recordAssembled.mockRejectedValue(new Error("BD caída"));
    mocks.job = reserved();
    expect(await (await reportAiJob(ok(validOutput), JOB)).json()).toEqual({ status: "completado", evaluationId: "eval-ia-1" });
  });

  it("segundo juez: su resultado activa o rechaza la regla; con límite o error se libera la reserva", async () => {
    mocks.judgment = { id: JOB };
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "learn_report_judgment" ? { data: "activa", error: null } : { data: null, error: null },
    );
    expect(await (await reportAiJob(ok({ equivalent: true, reason: "Es lo mismo." }, { model: "claude-opus-5-5" }), JOB)).json()).toEqual({
      status: "activa",
    });
    expect(rpcCalls("learn_report_judgment")).toEqual([
      { p_id: JOB, p_token: TOKEN, p_equivalent: true, p_reason: "Es lo mismo.", p_model: "claude-opus-5-5" },
    ]);
    expect(rpcCalls("ai_complete_job")).toEqual([]);

    await reportAiJob(req("/x", { outcome: "limite", claimToken: TOKEN, errorCode: "limite_plan" }), JOB);
    await reportAiJob(ok({ equivalent: "quizás" }), JOB); // salida inválida: se reintenta
    expect(rpcCalls("learn_release_judgment")).toEqual([
      { p_id: JOB, p_token: TOKEN },
      { p_id: JOB, p_token: TOKEN },
    ]);
  });

  it("si el CV cambió desde la reserva, devuelve el trabajo a la cola sin registrar", async () => {
    mocks.job = { ...reserved(), input_sha256: "0".repeat(64) };
    const response = await reportAiJob(ok(validOutput), JOB);
    expect(await response.json()).toEqual({ status: "pendiente" });
    expect(rpcCalls("ai_release_job")).toEqual([expect.objectContaining({ p_outcome: "reprogramar" })]);
    expect(rpcCalls("ai_complete_job")).toEqual([]);
  });

  it("una salida que no cumple el esquema se reintenta", async () => {
    mocks.job = reserved();
    await reportAiJob(ok({ items: "no" }), JOB);
    expect(rpcCalls("ai_release_job")).toEqual([
      expect.objectContaining({ p_outcome: "reintentar", p_error_code: "respuesta_invalida" }),
    ]);
  });

  it("el límite del plan y los errores se trasladan a la cola", async () => {
    const retryAt = "2026-11-16T20:00:00.000Z";
    await reportAiJob(req("/x", { outcome: "limite", claimToken: TOKEN, retryAt }), JOB);
    await reportAiJob(req("/x", { outcome: "error", claimToken: TOKEN, errorCode: "cli_timeout" }), JOB);
    await reportAiJob(req("/x", { outcome: "error", claimToken: TOKEN, errorCode: "rechazo", retryable: false }), JOB);
    expect(rpcCalls("ai_release_job")).toEqual([
      { p_job_id: JOB, p_claim_token: TOKEN, p_outcome: "limite", p_error_code: "limite_plan", p_retry_at: retryAt },
      { p_job_id: JOB, p_claim_token: TOKEN, p_outcome: "reintentar", p_error_code: "cli_timeout", p_retry_at: undefined },
      { p_job_id: JOB, p_claim_token: TOKEN, p_outcome: "error", p_error_code: "rechazo", p_retry_at: undefined },
    ]);
  });

  it("rechaza cuerpos inválidos, sin token y trabajos que no están reservados", async () => {
    expect((await reportAiJob(req("/x", { outcome: "otro", claimToken: TOKEN }), JOB)).status).toBe(422);
    expect((await reportAiJob(req("/x", { outcome: "ok", output: validOutput }), JOB)).status).toBe(422);
    expect((await reportAiJob(ok({}), "no-es-uuid")).status).toBe(422);
    mocks.job = { ...reserved(), status: "pendiente" };
    expect((await reportAiJob(ok(validOutput), JOB)).status).toBe(404);
  });

  it("no registra el resultado de una reserva vencida (otro worker tomó el trabajo)", async () => {
    mocks.job = { ...reserved(), claim_token: OTHER_TOKEN };
    expect((await reportAiJob(ok(validOutput), JOB)).status).toBe(404);
    expect(rpcCalls("ai_complete_job")).toEqual([]);
    expect(rpcCalls("ai_release_job")).toEqual([]);
  });

  it("si la BD rechaza el registro (RH422), reintenta contando intento", async () => {
    mocks.job = reserved();
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "ai_complete_job"
        ? { data: null, error: { code: "RH422", message: "La evaluación no respeta las verificaciones registradas" } }
        : { data: "pendiente", error: null },
    );
    expect(await (await reportAiJob(ok(validOutput), JOB)).json()).toEqual({ status: "pendiente" });
    expect(rpcCalls("ai_release_job")).toEqual([
      expect.objectContaining({ p_outcome: "reintentar", p_error_code: "registro_rechazado" }),
    ]);
  });
});

describe("API del worker: vigilancia semanal de la IA", () => {
  const report = (vara: Record<string, number> | null, extra: Record<string, unknown> = {}) => ({
    modelo: "claude-haiku-5-5",
    prompt: "ia-prompt-v5",
    cv: 32,
    fallos: 0,
    inversionesIa: 1,
    segundosPorCv: 17.4,
    vara,
    ...extra,
  });
  const good = { casillas: 248, motor: 0.96, ia: 0.89, motorIa: 0.97, motorIaLaxo: 0.97, iaLaxo: 0.94, iaAcreditoDeMas: 1 };

  it("con el acierto de siempre la guarda como «ok» y no avisa a nadie", async () => {
    mocks.admins = [{ email: "admin1@empresa.test" }];
    const response = await reportAiQualityCheck(req("/api/ia/vigilancia", report(good)));
    expect(await response.json()).toEqual({ status: "ok" });
    expect(mocks.inserts).toEqual([
      {
        table: "ai_quality_checks",
        row: expect.objectContaining({ model: "claude-haiku-5-5", prompt_version: "ia-prompt-v5", cells: 248, accuracy_relay_lenient: 0.97, ai_over_accredited: 1, status: "ok", reasons: [] }),
      },
    ]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("si baja el acierto o acredita de más, la guarda como «alerta» y avisa a administración con los motivos", async () => {
    mocks.admins = [{ email: "admin1@empresa.test" }, { email: null }];
    const response = await reportAiQualityCheck(req("/api/ia/vigilancia", report({ ...good, motorIaLaxo: 0.9, iaAcreditoDeMas: 4 })));
    expect(await response.json()).toEqual({ status: "alerta" });
    expect(mocks.inserts[0]!.row).toMatchObject({ status: "alerta" });
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const mail = mocks.sendEmail.mock.calls[0]![0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe("admin1@empresa.test");
    expect(mail.text).toMatch(/bajó a 90,0 %/);
    expect(mail.text).toMatch(/acreditó de más 4/);
  });

  it("una medición que no pudo correr (sin CV ni vara) también avisa", async () => {
    mocks.admins = [{ email: "admin1@empresa.test" }];
    const response = await reportAiQualityCheck(req("/api/ia/vigilancia", report(null, { prompt: "sin-medicion", cv: 0 })));
    expect(await response.json()).toEqual({ status: "alerta" });
    expect((mocks.inserts[0]!.row as { reasons: string[] }).reasons).toEqual([
      "No se evaluó ningún CV.",
      "No se pudo comparar con la vara (sin casillas).",
    ]);
  });

  it("formato inválido → 422; sin el secreto → 404 (la API no existe)", async () => {
    expect((await reportAiQualityCheck(req("/api/ia/vigilancia", { modelo: "x" }))).status).toBe(422);
    expect((await reportAiQualityCheck(req("/api/ia/vigilancia", report(good), "otro"))).status).toBe(404);
    expect(mocks.inserts).toEqual([]);
  });
});

describe("preguntas para profundizar: encolado", () => {
  const rpc = vi.fn();
  const supabase = { rpc } as unknown as Parameters<typeof autoEnqueueDeepDive>[0];

  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: "deep-1", error: null });
  });

  it("encola en automático solo con la IA disponible y en cola", async () => {
    await autoEnqueueDeepDive(supabase, APP);
    expect(rpc).toHaveBeenCalledWith("request_interview_deep_dive", { p_application_id: APP, p_automatic: true });

    rpc.mockClear();
    mocks.env.AI_EXTERNAL_PROCESSING_APPROVED = false;
    await autoEnqueueDeepDive(supabase, APP);
    expect(rpc).not.toHaveBeenCalled();

    mocks.env = { ...mocks.env, AI_EXTERNAL_PROCESSING_APPROVED: true, AI_PROVIDER: "anthropic", AI_API_KEY: "k" };
    await autoEnqueueDeepDive(supabase, APP);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("una evaluación desactualizada se explica en palabras de RRHH", () => {
    expect(describeAiJobError("evaluacion_desactualizada")).toMatch(/vuelva a evaluar/i);
  });

  it("con AI_AUTO_ENQUEUE=off no encola", async () => {
    mocks.env.AI_AUTO_ENQUEUE = "off";
    await autoEnqueueDeepDive(supabase, APP);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un error al encolar no se propaga", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "falla", code: "XX000" } });
    await expect(autoEnqueueDeepDive(supabase, APP)).resolves.toBeUndefined();
    rpc.mockRejectedValue(new Error("red caída"));
    await expect(autoEnqueueDeepDive(supabase, APP)).resolves.toBeUndefined();
  });
});

describe("API del worker: preguntas para profundizar", () => {
  const guideItem = (overrides: Partial<GuideItemInput>): GuideItemInput => ({
    requirementId: R1,
    description: "Excel avanzado",
    category: "habilidad_tecnica",
    priority: "obligatorio",
    weight: 5,
    isEssential: false,
    minYears: null,
    position: 0,
    assessment: "acreditado",
    rationale: "Lo declara.",
    evidence: [{ quote: "Excel avanzado y tablas dinámicas. Contacto: ana.ficticia@correo.test" }],
    verified: false,
    ...overrides,
  });
  const bundle = (overrides: Record<string, unknown> = {}) => ({
    evaluationId: "ev-1",
    resumeId: "res-1",
    criteriaVersion: 2,
    items: [
      guideItem({}),
      guideItem({
        requirementId: R2,
        description: "Inglés intermedio",
        category: "idioma",
        priority: "deseable",
        assessment: "sin_evidencia",
        evidence: [],
        position: 1,
      }),
    ],
    ...overrides,
  });
  const claimedDeepDive = [{ deep_dive_id: JOB, application_id: APP, attempts: 1, claim_token: TOKEN }];

  /** Cola de CV vacía (o con un CV) y una tarea de preguntas la primera vez. */
  function queue(options: { cvJob?: boolean } = {}) {
    let deepClaims = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "ai_claim_job")
        return { data: options.cvJob ? [{ job_id: JOB, application_id: APP, attempts: 1, claim_token: TOKEN }] : [], error: null };
      if (name === "deep_dive_claim") return { data: deepClaims++ === 0 ? claimedDeepDive : [], error: null };
      if (name === "learn_claim_judgment") return { data: [], error: null };
      if (name === "deep_dive_release") return { data: "error", error: null };
      return { data: null, error: null };
    });
  }

  beforeEach(() => {
    mocks.env.AI_LEARN_MIN_CONFIRMATIONS = 1;
    mocks.application = { id: APP, vacancy_id: "vac-1", latest_evaluation_id: "ev-1" };
    mocks.guideItems = new Map([[APP, bundle()]]);
  });

  it("sin CV en cola entrega las preguntas antes que el juez", async () => {
    queue();
    const body = (await (await claimAiJob(req("/api/ia/trabajos/siguiente"))).json()) as { job: Record<string, unknown> };
    expect(body.job).toMatchObject({ id: JOB, claimToken: TOKEN, attempt: 1, model: "claude-opus-5-5", effort: "medium" });
    expect(body.job.schema).toEqual(DEEP_DIVE_JSON_SCHEMA);
    const prompt = String(body.job.prompt);
    expect(prompt).toContain(`id: ${R1}`);
    expect(prompt).toContain(`id: ${R2}`);
    expect(prompt).not.toContain("ana.ficticia@correo.test");
    expect(rpcCalls("deep_dive_start")).toEqual([
      {
        p_id: JOB,
        p_token: TOKEN,
        p_evaluation_id: "ev-1",
        p_resume_id: "res-1",
        p_criteria_version: 2,
        p_requested_items: [
          { requirement_id: R1, kind: "profundizar" },
          { requirement_id: R2, kind: "confirmar" },
        ],
      },
    ]);
    expect(rpcCalls("learn_claim_judgment")).toEqual([]);
  });

  it("con CV en cola entrega primero el CV", async () => {
    queue({ cvJob: true });
    const body = (await (await claimAiJob(req("/api/ia/trabajos/siguiente"))).json()) as { job: Record<string, unknown> };
    expect(body.job.schema).toEqual(AI_OUTPUT_JSON_SCHEMA);
    expect(rpcCalls("deep_dive_claim")).toEqual([]);
  });

  it("si la evaluación vigente es de otro CV o criterios, cierra con evaluacion_desactualizada y sigue", async () => {
    queue();
    mocks.guideItems = new Map([[APP, bundle({ resumeId: "res-viejo" })]]);
    const body = await (await claimAiJob(req("/api/ia/trabajos/siguiente"))).json();
    expect(body).toEqual({ job: null });
    expect(rpcCalls("deep_dive_release")).toEqual([
      { p_id: JOB, p_token: TOKEN, p_outcome: "error", p_error_code: "evaluacion_desactualizada", p_retry_at: undefined },
    ]);
  });

  it("si no hay nada que preguntar, cierra con sin_preguntas sin llamar a la IA", async () => {
    queue();
    mocks.guideItems = new Map([[APP, bundle({ items: [guideItem({ verified: true })] })]]);
    const body = await (await claimAiJob(req("/api/ia/trabajos/siguiente"))).json();
    expect(body).toEqual({ job: null });
    expect(rpcCalls("deep_dive_release")).toEqual([
      { p_id: JOB, p_token: TOKEN, p_outcome: "error", p_error_code: "sin_preguntas", p_retry_at: undefined },
    ]);
    expect(rpcCalls("deep_dive_start")).toEqual([]);
  });

  describe("resultado", () => {
    beforeEach(() => {
      mocks.deepDive = { id: JOB, status: "procesando", claim_token: TOKEN };
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "deep_dive_complete") return { data: 1, error: null };
        if (name === "deep_dive_release") return { data: "pendiente", error: null };
        return { data: null, error: null };
      });
    });

    it("el resultado válido se guarda con deep_dive_complete, el modelo y la versión del prompt", async () => {
      const output = {
        questions: [{ requirement_id: R1, kind: "profundizar", question: "¿Qué tablas dinámicas armó?", listen_for: "Pasos concretos." }],
      };
      const response = await reportAiJob(req("/x", { outcome: "ok", claimToken: TOKEN, output, model: "claude-haiku-5-5" }), JOB);
      expect(await response.json()).toEqual({ status: "completado", saved: 1 });
      expect(rpcCalls("deep_dive_complete")).toEqual([
        {
          p_id: JOB,
          p_token: TOKEN,
          p_questions: [{ requirement_id: R1, kind: "profundizar", question: "¿Qué tablas dinámicas armó?", listen_for: "Pasos concretos." }],
          p_model: "claude-haiku-5-5",
          p_prompt_version: "ia-preguntas-v1",
        },
      ]);
      expect(rpcCalls("ai_complete_job")).toEqual([]);
    });

    it("una salida inválida se reintenta con respuesta_invalida", async () => {
      await reportAiJob(req("/x", { outcome: "ok", claimToken: TOKEN, output: "texto libre" }), JOB);
      expect(rpcCalls("deep_dive_release")).toEqual([
        { p_id: JOB, p_token: TOKEN, p_outcome: "reintentar", p_error_code: "respuesta_invalida", p_retry_at: undefined },
      ]);
    });

    it("si la base rechaza todas las preguntas (RH422), se reintenta con respuesta_invalida", async () => {
      mocks.rpc.mockImplementation(async (name: string) =>
        name === "deep_dive_complete"
          ? { data: null, error: { code: "RH422", message: "La respuesta no trae ninguna pregunta válida" } }
          : { data: "pendiente", error: null },
      );
      const output = { questions: [{ requirement_id: "otro", kind: "profundizar", question: "¿?", listen_for: "" }] };
      await reportAiJob(req("/x", { outcome: "ok", claimToken: TOKEN, output }), JOB);
      expect(rpcCalls("deep_dive_release")).toEqual([
        { p_id: JOB, p_token: TOKEN, p_outcome: "reintentar", p_error_code: "respuesta_invalida", p_retry_at: undefined },
      ]);
    });

    it("límite y error se liberan con deep_dive_release", async () => {
      await reportAiJob(
        req("/x", { outcome: "limite", claimToken: TOKEN, errorCode: "limite_plan", retryAt: "2026-11-20T15:00:00Z" }),
        JOB,
      );
      await reportAiJob(req("/x", { outcome: "error", claimToken: TOKEN, errorCode: "cli_timeout", retryable: false }), JOB);
      expect(rpcCalls("deep_dive_release")).toEqual([
        { p_id: JOB, p_token: TOKEN, p_outcome: "limite", p_error_code: "limite_plan", p_retry_at: "2026-11-20T15:00:00Z" },
        { p_id: JOB, p_token: TOKEN, p_outcome: "error", p_error_code: "cli_timeout", p_retry_at: undefined },
      ]);
      expect(rpcCalls("ai_release_job")).toEqual([]);
    });
  });

  it("un id que no es de preguntas sigue al flujo del CV como antes", async () => {
    mocks.deepDive = null;
    mocks.job = { id: JOB, application_id: APP, status: "procesando", claim_token: TOKEN, input_sha256: sentSha(), criteria_version: 2 };
    await reportAiJob(req("/x", { outcome: "limite", claimToken: TOKEN, errorCode: "limite_plan" }), JOB);
    expect(rpcCalls("deep_dive_release")).toEqual([]);
    expect(rpcCalls("ai_release_job")).toHaveLength(1);
  });
});
