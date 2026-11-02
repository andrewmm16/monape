import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

const SECRET = "secreto-ficticio-de-pruebas-0123456789abcdef";
const APP_ID = "0b1f6a52-3c1e-4c53-9d6e-2f1f3a7a9c11";

const mocks = vi.hoisted(() => ({ secret: undefined as string | undefined, latest: null as string | null, evaluate: vi.fn() }));

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ EVALUATION_WEBHOOK_SECRET: mocks.secret }) }));
vi.mock("@/modules/evaluation/service", async () => {
  const { AppError: Base } = await import("@/lib/errors");
  class ResumeTextUnavailableError extends Base {}
  return { evaluateApplication: (...args: unknown[]) => mocks.evaluate(...args), ResumeTextUnavailableError };
});
vi.mock("@/modules/resumes/ocr-apply", () => ({ applyOcrToResume: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const row =
        table === "applications"
          ? { latest_evaluation_id: mocks.latest, candidate_id: "c", resume_id: null }
          : table === "candidate_evaluations"
            ? { score: 72, level: "alta" }
            : null;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: row, error: null });
      return chain;
    },
    storage: { from: () => ({ download: vi.fn() }) },
  }),
}));

import { handleEvaluateWebhook } from "@/modules/evaluation/webhook";

function post(body: unknown, token: string | null = SECRET) {
  return new Request("http://localhost/api/evaluar-cv", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("webhook /api/evaluar-cv", () => {
  beforeEach(() => {
    mocks.secret = SECRET;
    mocks.latest = null;
    mocks.evaluate.mockReset().mockResolvedValue("eval-1");
  });

  it("responde 404 si está apagado, sin token o con token incorrecto", async () => {
    mocks.secret = undefined;
    expect((await handleEvaluateWebhook(post({ applicationId: APP_ID }))).status).toBe(404);
    mocks.secret = SECRET;
    expect((await handleEvaluateWebhook(post({ applicationId: APP_ID }, null))).status).toBe(404);
    expect((await handleEvaluateWebhook(post({ applicationId: APP_ID }, "otro"))).status).toBe(404);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it("rechaza JSON o payload inválidos", async () => {
    expect((await handleEvaluateWebhook(post("{no json"))).status).toBe(400);
    expect((await handleEvaluateWebhook(post({ applicationId: "no-uuid" }))).status).toBe(422);
  });

  it("evalúa con reglas en modo sistema y devuelve el puntaje", async () => {
    const response = await handleEvaluateWebhook(post({ applicationId: APP_ID }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "evaluada", evaluationId: "eval-1", score: 72 });
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.anything(), APP_ID, "reglas", { system: true });
  });

  it("acepta el formato de Database Webhook de Supabase", async () => {
    const response = await handleEvaluateWebhook(
      post({ type: "INSERT", table: "applications", schema: "public", record: { id: APP_ID } }),
    );
    expect(response.status).toBe(200);
  });

  it("es idempotente salvo con force", async () => {
    mocks.latest = "eval-previa";
    const skipped = await handleEvaluateWebhook(post({ applicationId: APP_ID }));
    expect(await skipped.json()).toMatchObject({ status: "ya_evaluada", evaluationId: "eval-previa" });
    expect(mocks.evaluate).not.toHaveBeenCalled();
    await handleEvaluateWebhook(post({ applicationId: APP_ID, force: true }));
    expect(mocks.evaluate).toHaveBeenCalledOnce();
  });

  it("traduce los conflictos de evaluación a 409", async () => {
    mocks.evaluate.mockRejectedValue(new AppError("criterios", "conflict"));
    expect((await handleEvaluateWebhook(post({ applicationId: APP_ID }))).status).toBe(409);
  });
});
