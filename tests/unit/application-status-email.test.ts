import { beforeEach, describe, expect, it, vi } from "vitest";

const APP = "00000000-0000-4000-8000-00000000000a";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  rpc: vi.fn(),
  row: { id: "x", candidates: { full_name: "Ana Pérez", email: "ana@example.com" }, vacancies: { title: "Contador" } } as unknown,
  lookupError: null as unknown,
  afterThrows: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    if (mocks.afterThrows) throw new Error("fuera de request");
    return fn();
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async () => undefined,
  requireActiveUser: async () => ({ role: "rrhh" }),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ PUBLIC_COMPANY_NAME: "Acme" }) }));
vi.mock("@/modules/notifications/email/client", () => ({ sendEmail: (...a: unknown[]) => mocks.sendEmail(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.row, error: mocks.lookupError }) }) }),
    }),
  }),
}));

import { changeApplicationStatus } from "@/modules/applications/actions";

const base = { applicationId: APP, reason: "Perfil no encaja con el puesto", note: "interna" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.sendEmail.mockResolvedValue({ sent: true });
  mocks.row = { id: "x", candidates: { full_name: "Ana Pérez", email: "ana@example.com" }, vacancies: { title: "Contador" } };
  mocks.lookupError = null;
  mocks.afterThrows = false;
});

describe("aviso de cambio de estado al candidato", () => {
  it("envía el correo del estado con notifyCandidate=true", async () => {
    const result = await changeApplicationStatus({ ...base, status: "entrevista_programada", notifyCandidate: true });
    expect(result.ok).toBe(true);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const mail = mocks.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("ana@example.com");
    expect(mail.tags).toEqual([{ name: "type", value: "application_status_entrevista_programada" }]);
    expect(mail.subject).toMatch(/entrevista/i);
  });

  it("el rechazo no filtra el motivo ni la nota internos", async () => {
    await changeApplicationStatus({ ...base, status: "no_seleccionado", notifyCandidate: true });
    const mail = mocks.sendEmail.mock.calls[0][0];
    expect(mail.text).not.toContain("no encaja");
    expect(mail.html).not.toContain("interna");
  });

  it("no envía por defecto ni con notifyCandidate=false", async () => {
    await changeApplicationStatus({ ...base, status: "seleccionado" });
    await changeApplicationStatus({ ...base, status: "seleccionado", notifyCandidate: false });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("no envía en estados no comunicables", async () => {
    const result = await changeApplicationStatus({ ...base, status: "en_revision", notifyCandidate: true });
    expect(result.ok).toBe(true);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("sin correo del candidato no envía", async () => {
    mocks.row = { id: "x", candidates: { full_name: "Ana", email: null }, vacancies: { title: "T" } };
    const result = await changeApplicationStatus({ ...base, status: "seleccionado", notifyCandidate: true });
    expect(result.ok).toBe(true);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("un fallo del correo no rompe la acción", async () => {
    mocks.sendEmail.mockRejectedValue(new Error("resend caído"));
    const result = await changeApplicationStatus({ ...base, status: "seleccionado", notifyCandidate: true });
    expect(result.ok).toBe(true);
  });

  it("un fallo al consultar o al diferir no rompe la acción", async () => {
    mocks.lookupError = new Error("rls");
    expect((await changeApplicationStatus({ ...base, status: "seleccionado", notifyCandidate: true })).ok).toBe(true);
    mocks.afterThrows = true;
    expect((await changeApplicationStatus({ ...base, status: "seleccionado", notifyCandidate: true })).ok).toBe(true);
  });

  it("si el cambio de estado falla no se envía correo", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "x", code: "P0001" } });
    const result = await changeApplicationStatus({ ...base, status: "seleccionado", notifyCandidate: true });
    expect(result.ok).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
