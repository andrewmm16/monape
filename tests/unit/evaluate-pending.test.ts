import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeOcrResult } from "@/modules/resumes/ocr-apply";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const VACANCY = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  pending: [] as { id: string; candidate_name: string }[],
  remaining: 0,
  clock: 0,
  /** Milisegundos que avanza el reloj con cada evaluación correcta. */
  step: 100,
  /** Por postulación: resultados sucesivos de evaluateApplication ("ok", "sin_texto" o "error"). */
  evaluations: new Map<string, string[]>(),
  evaluateCalls: [] as string[],
  limitedBuckets: new Set<string>(),
  buckets: [] as string[],
  ocr: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => undefined,
  requireActiveUser: async () => ({ role: "rrhh" }),
}));
vi.mock("@/lib/rate-limit", async () => {
  const { AppError } = await import("@/lib/errors");
  return {
    RATE_LIMITS: { evaluationBulk: "evaluation_bulk", cvOcr: "cv_ocr" },
    enforceRateLimit: async (_supabase: unknown, bucket: string) => {
      mocks.buckets.push(bucket);
      if (mocks.limitedBuckets.has(bucket)) throw new AppError("Demasiadas solicitudes.", "rate_limited");
    },
  };
});
vi.mock("@/modules/evaluation/service", async () => {
  const { AppError } = await import("@/lib/errors");
  class ResumeTextUnavailableError extends AppError {
    constructor(message: string) {
      super(message, "conflict");
    }
  }
  return {
    CRITERIA_NOT_APPROVED_MESSAGE: "criterios",
    ResumeTextUnavailableError,
    evaluateApplication: async (_supabase: unknown, id: string) => {
      mocks.evaluateCalls.push(id);
      const next = mocks.evaluations.get(id)?.shift() ?? "ok";
      if (next === "sin_texto") throw new ResumeTextUnavailableError("No hay texto legible del CV.");
      if (next === "error") throw new Error("falla");
      mocks.clock += mocks.step;
      return "evaluation-id";
    },
  };
});
vi.mock("@/modules/resumes/ocr-apply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/resumes/ocr-apply")>()),
  applyOcrToResume: (...args: unknown[]) => mocks.ocr(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: () => ({ download: async () => ({ data: { arrayBuffer: async () => new ArrayBuffer(3) }, error: null }) }),
    },
  }),
}));
vi.mock("@/modules/applications/queries", () => ({
  pendingEvaluationsQuery: (_supabase: unknown, _vacancy: string, options: { head?: boolean } = {}) => {
    if (options.head) {
      const head = { gt: () => head, then: (resolve: (value: unknown) => void) => resolve({ count: mocks.remaining, error: null }) };
      return head;
    }
    const list = { gt: () => list, order: () => list, limit: async () => ({ data: mocks.pending, error: null }) };
    return list;
  },
}));
vi.mock("@/lib/supabase/server", () => {
  const rows: Record<string, unknown> = {
    vacancies: { id: VACANCY, criteria_approved_at: "2026-10-28T00:00:00Z" },
    applications: { candidate_id: "cand", resume_id: "res" },
    resumes: {
      id: "res",
      storage_path: "candidates/cand/res.pdf",
      mime_type: "application/pdf",
      resume_extractions: { status: "sin_texto", method: "pdf_text", corrected_text: null },
    },
  };
  return {
    createSupabaseServerClient: async () => ({
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        for (const method of ["select", "eq"]) builder[method] = () => builder;
        builder.maybeSingle = async () => ({ data: rows[table], error: null });
        return builder;
      },
    }),
  };
});

const { evaluatePendingApplications } = await import("@/modules/applications/actions");

type Summary = Awaited<ReturnType<typeof evaluatePendingApplications>>;
const dataOf = (result: Summary) => {
  if (!result.ok) throw new Error(`falló: ${result.error}`);
  return result.data;
};

beforeEach(() => {
  mocks.pending = [];
  mocks.remaining = 0;
  mocks.clock = 0;
  mocks.step = 100;
  mocks.evaluations.clear();
  mocks.evaluateCalls.length = 0;
  mocks.limitedBuckets.clear();
  mocks.buckets.length = 0;
  mocks.ocr.mockReset().mockResolvedValue({ attempted: true, applied: true, status: "completada", failed: false });
  vi.spyOn(Date, "now").mockImplementation(() => mocks.clock);
});

const scanned = (...ids: string[]) => ids.forEach((id) => mocks.evaluations.set(id, ["sin_texto", "ok"]));
const names = (...ids: string[]) => (mocks.pending = ids.map((id) => ({ id, candidate_name: `Candidato ${id.slice(-1)}` })));

describe("evaluatePendingApplications con escaneados", () => {
  it("lee un escaneado con OCR, pasa un plazo de cola corto y evalúa", async () => {
    names(A);
    scanned(A);
    const data = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null }));
    expect(data).toMatchObject({ evaluated: 1, ocrRead: 1, withoutText: [], failed: 0, nextCursor: A });
    expect(mocks.ocr).toHaveBeenCalledWith(expect.anything(), "res", expect.any(Uint8Array), { queueTimeoutMs: 5_000 });
    expect(mocks.buckets).toEqual(["evaluation_bulk", "cv_ocr"]);
  });

  it("solo un OCR por llamada: el siguiente escaneado queda para la próxima sin saltarse ninguno", async () => {
    names(A, B, C);
    scanned(A, B);
    mocks.remaining = 2;
    const data = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null }));
    expect(data).toMatchObject({ evaluated: 1, ocrRead: 1, nextCursor: A, remaining: 2 });
    expect(data.withoutText).toEqual([]);
    expect(mocks.ocr).toHaveBeenCalledTimes(1);
    // La siguiente llamada arranca después de A y trata B primero.
    names(B, C);
    scanned(B);
    const next = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: A }));
    expect(next).toMatchObject({ evaluated: 2, ocrRead: 1, nextCursor: C });
  });

  it("no lanza un OCR si pasaron más de 2 s desde el inicio de la llamada", async () => {
    names(A, B);
    scanned(B);
    // Tras evaluar A el reloj ya pasó la ventana de 2 s.
    mocks.step = 3_000;
    mocks.remaining = 1;
    const data = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null }));
    expect(mocks.ocr).not.toHaveBeenCalled();
    expect(data).toMatchObject({ evaluated: 1, ocrRead: 0, nextCursor: A, remaining: 1, withoutText: [] });
  });

  it("si el escaneado es el primero y no se lanza el OCR, cuenta como sin texto y el cursor avanza", async () => {
    names(A);
    scanned(A);
    mocks.ocr.mockResolvedValue({ attempted: false });
    const data = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null }));
    expect(data.withoutText).toEqual([{ applicationId: A, candidateName: "Candidato a" }]);
    expect(data).toMatchObject({ evaluated: 0, nextCursor: A });
  });

  it("si el OCR no se pudo lanzar (cola ocupada) después de otras, queda para la siguiente llamada", async () => {
    names(A, B);
    mocks.evaluations.set(A, ["ok"]);
    scanned(B);
    mocks.ocr.mockResolvedValue({ attempted: false });
    mocks.remaining = 1;
    const data = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null }));
    expect(data).toMatchObject({ evaluated: 1, nextCursor: A, remaining: 1, withoutText: [] });
  });

  it("límite cv_ocr alcanzado: no lanza el OCR, cuenta como sin texto y la llamada no falla", async () => {
    mocks.limitedBuckets.add("cv_ocr");
    names(A, B);
    scanned(A, B);
    const result = await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null });
    const data = dataOf(result);
    expect(mocks.ocr).not.toHaveBeenCalled();
    expect(data.withoutText.map((item) => item.applicationId)).toEqual([A, B]);
    expect(data).toMatchObject({ evaluated: 0, failed: 0, nextCursor: B });
  });

  it("si RRHH transcribió mientras se leía (no se aplicó), reintenta la evaluación una vez", async () => {
    names(A);
    scanned(A);
    mocks.ocr.mockResolvedValue({ attempted: true, applied: false, status: "completada", failed: false });
    const data = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null }));
    expect(data).toMatchObject({ evaluated: 1, ocrRead: 0, withoutText: [] });
    expect(mocks.evaluateCalls).toEqual([A, A]);
  });

  it("OCR sin texto útil: queda como sin texto y se marca el OCR como usado", async () => {
    names(A, B, C);
    scanned(A, B);
    mocks.ocr.mockResolvedValue({ attempted: true, applied: true, status: "sin_texto", failed: false });
    mocks.remaining = 2;
    const data = dataOf(await evaluatePendingApplications({ vacancyId: VACANCY, cursor: null }));
    expect(data.withoutText.map((item) => item.applicationId)).toEqual([A]);
    // B no se procesó: ya se usó el OCR de la llamada.
    expect(data).toMatchObject({ nextCursor: A, remaining: 2 });
    expect(mocks.ocr).toHaveBeenCalledTimes(1);
  });
});

describe("mensaje de la lectura manual", () => {
  it("depende del resultado", () => {
    expect(describeOcrResult({ status: "completada", failed: false })).toMatch(/^Lectura terminada/);
    expect(describeOcrResult({ status: "sin_texto", failed: false })).toBe(
      "El reconocimiento no encontró texto útil; puede transcribirlo.",
    );
    expect(describeOcrResult({ status: "sin_texto", failed: true })).toMatch(/^No se pudo leer el escaneo/);
  });
});
