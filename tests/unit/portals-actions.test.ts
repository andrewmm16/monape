import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const VACANCY = "0b1f6a52-3c1e-4c53-9d6e-2f1f3a7a9c11";
const PUBLICATION_B = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  publications: new Map<string, string>(),
  requirePermission: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from: () => {
      const filters: Record<string, string> = {};
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: string) => {
        filters[column] = value;
        return chain;
      };
      chain.maybeSingle = async () => {
        const id = mocks.publications.get(filters.portal_id!);
        return { data: id ? { id } : null, error: null };
      };
      return chain;
    },
  }),
}));

import { applyPortalSelection } from "@/modules/portals/actions";

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.publications = new Map([[B, PUBLICATION_B]]);
});

describe("edición de portales de una vacante", () => {
  it("publica en los marcados y retira de los desmarcados", async () => {
    const result = await applyPortalSelection(VACANCY, [A], [B]);
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("request_portal_publication", { p_vacancy_id: VACANCY, p_portal_id: A });
    expect(mocks.rpc).toHaveBeenCalledWith("request_portal_withdrawal", { p_publication_id: PUBLICATION_B });
    expect(result.ok && result.message).toMatch(/publicación solicitada en 1 y retiro solicitado en 1/);
  });

  it("si un portal falla, aplica los demás e informa cuántos no se pudieron", async () => {
    mocks.rpc.mockImplementation(async (name: string, args: { p_portal_id?: string }) =>
      name === "request_portal_publication" && args.p_portal_id === A
        ? { data: null, error: { code: "RH409", message: "ya solicitado" } }
        : { data: null, error: null },
    );
    const result = await applyPortalSelection(VACANCY, [A, C], []);
    expect(result.ok).toBe(true);
    expect(result.ok && result.message).toMatch(/1 cambio\(s\) no se pudo/);
  });

  it("si ningún cambio se logra, devuelve el error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "RH409", message: "ya solicitado" } });
    const result = await applyPortalSelection(VACANCY, [A], []);
    expect(result.ok).toBe(false);
  });

  it("rechaza una solicitud sin cambios o con identificadores inválidos, sin llamar a la base de datos", async () => {
    expect((await applyPortalSelection(VACANCY, [], [])).ok).toBe(false);
    expect((await applyPortalSelection("no-uuid", [A], [])).ok).toBe(false);
    expect((await applyPortalSelection(VACANCY, ["x"], [])).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("exige el permiso de gestionar vacantes", async () => {
    await applyPortalSelection(VACANCY, [A], []);
    expect(mocks.requirePermission).toHaveBeenCalledWith("vacancies:manage");
  });
});
