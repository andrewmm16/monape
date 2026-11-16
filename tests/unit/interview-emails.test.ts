import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: [] as (() => Promise<void>)[],
  afterThrows: false,
  send: vi.fn(),
  logged: [] as unknown[][],
  row: null as Record<string, unknown> | null,
  rpcError: null as { message: string } | null,
}));

vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    if (mocks.afterThrows) throw new Error("fuera de contexto");
    mocks.after.push(callback);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: async () => undefined }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ PUBLIC_COMPANY_NAME: "Empresa Ficticia" }) }));
vi.mock("@/lib/errors", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/errors")>();
  return {
    ...original,
    logServerError: (...args: unknown[]) => {
      mocks.logged.push(args);
    },
  };
});
vi.mock("@/modules/evaluation/reevaluate", () => ({ reevaluateAfterVerification: async () => ({}) }));
vi.mock("@/modules/notifications/email/client", () => ({
  sendEmail: (...args: unknown[]) => mocks.send(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string) => {
      if (mocks.rpcError) return { data: null, error: mocks.rpcError };
      return { data: name === "schedule_interview" ? "int-1" : null, error: null };
    },
    from: () => {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({ data: mocks.row, error: null });
      return query;
    },
  }),
}));

import { cancelInterview, rescheduleInterview, scheduleInterview } from "@/modules/interviews/actions";

const ROW = {
  id: "int-1",
  application_id: "app-1",
  scheduled_at: "2026-12-03T15:30:00-05:00",
  duration_minutes: 45,
  modality: "virtual",
  location: "https://meet.example.com/abc",
  instructions: "Conéctate 5 minutos antes",
  applications: { candidates: { full_name: "Ana <Pérez>", email: "ana@example.com" }, vacancies: { title: "Analista" } },
};

const SCHEDULE = {
  applicationId: "5b0e2a43-98f4-4bd1-a0c2-0e6f2b3a1c10",
  date: "2026-12-03",
  time: "15:30",
  durationMinutes: "45",
  modality: "virtual",
  location: "https://meet.example.com/abc",
  interviewers: "",
  instructions: "",
} as never;

const flush = async () => {
  for (const callback of mocks.after.splice(0)) await callback();
};

beforeEach(() => {
  mocks.after.length = 0;
  mocks.afterThrows = false;
  mocks.logged.length = 0;
  mocks.rpcError = null;
  mocks.row = structuredClone(ROW);
  mocks.send.mockReset();
  mocks.send.mockResolvedValue({ sent: true });
});

describe("correos de entrevista", () => {
  it("programar: difiere y envía la invitación al candidato", async () => {
    const result = await scheduleInterview(SCHEDULE);
    expect(result.ok).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    await flush();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const sent = mocks.send.mock.calls[0]![0];
    expect(sent.to).toBe("ana@example.com");
    expect(sent.subject).toBe("Invitación a entrevista");
    expect(sent.tags).toEqual([{ name: "type", value: "interview_invitation" }]);
    expect(sent.text).toContain("Virtual");
    expect(sent.text).toContain("https://meet.example.com/abc");
    expect(sent.html).toContain("Ana &lt;Pérez&gt;");
  });

  it("reprogramar y cancelar envían su plantilla", async () => {
    const id = "5b0e2a43-98f4-4bd1-a0c2-0e6f2b3a1c11";
    expect((await rescheduleInterview({ ...(SCHEDULE as object), interviewId: id } as never)).ok).toBe(true);
    await flush();
    expect(mocks.send.mock.calls[0]![0].subject).toBe("Tu entrevista fue reprogramada");

    expect((await cancelInterview({ interviewId: id, reason: "Cambio de planes" } as never)).ok).toBe(true);
    await flush();
    expect(mocks.send.mock.calls[1]![0].subject).toBe("Tu entrevista fue cancelada");
    expect(mocks.send.mock.calls[1]![0].text).not.toContain("Cambio de planes");
  });

  it("un fallo de correo no rompe la acción ni registra la dirección", async () => {
    mocks.send.mockRejectedValue(new Error("fallo para ana@example.com"));
    const result = await scheduleInterview(SCHEDULE);
    expect(result.ok).toBe(true);
    await expect(flush()).resolves.toBeUndefined();
    expect(mocks.logged.some((args) => args[0] === "interview.email")).toBe(true);
  });

  it("si after() falla, la acción sigue siendo correcta", async () => {
    mocks.afterThrows = true;
    expect((await scheduleInterview(SCHEDULE)).ok).toBe(true);
  });

  it("sin correo del candidato no se envía", async () => {
    mocks.row = { ...ROW, applications: { candidates: { full_name: "Ana", email: null }, vacancies: null } };
    expect((await scheduleInterview(SCHEDULE)).ok).toBe(true);
    await flush();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("si la acción falla no se programa ningún correo", async () => {
    mocks.rpcError = { message: "error" };
    expect((await scheduleInterview(SCHEDULE)).ok).toBe(false);
    expect(mocks.after).toHaveLength(0);
  });
});
