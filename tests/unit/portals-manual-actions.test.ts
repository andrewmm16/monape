import { beforeEach, describe, expect, it, vi } from "vitest";

const VACANCY = "0b1f6a52-3c1e-4c53-9d6e-2f1f3a7a9c11";
const PORTAL = "11111111-1111-4111-8111-111111111111";
const PUBLICATION = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  requirePermission: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: (...args: unknown[]) => mocks.rpc(...args) }),
}));

import { markPortalPublishedManually, markPortalWithdrawnManually } from "@/modules/portals/actions";

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.revalidatePath.mockClear();
  mocks.requirePermission.mockClear();
});

describe("marcar publicada a mano", () => {
  it("llama a la función con el código recortado y refresca la ficha", async () => {
    const result = await markPortalPublishedManually(VACANCY, PORTAL, "  ABC-123 ", " https://portal.test/o/1 ");
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("mark_portal_published_manually", {
      p_vacancy_id: VACANCY,
      p_portal_id: PORTAL,
      p_external_id: "ABC-123",
      p_external_url: "https://portal.test/o/1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/vacantes/${VACANCY}`);
    expect(mocks.requirePermission).toHaveBeenCalledWith("vacancies:manage");
  });

  it("envía null cuando no hay enlace", async () => {
    await markPortalPublishedManually(VACANCY, PORTAL, "ABC", "  ");
    await markPortalPublishedManually(VACANCY, PORTAL, "ABC");
    for (const call of mocks.rpc.mock.calls) expect(call[1]).toMatchObject({ p_external_url: null });
  });

  it("rechaza datos inválidos sin llamar a la base de datos", async () => {
    expect((await markPortalPublishedManually("no-uuid", PORTAL, "ABC")).ok).toBe(false);
    expect((await markPortalPublishedManually(VACANCY, "x", "ABC")).ok).toBe(false);
    expect((await markPortalPublishedManually(VACANCY, PORTAL, "   ")).ok).toBe(false);
    expect((await markPortalPublishedManually(VACANCY, PORTAL, "x".repeat(201))).ok).toBe(false);
    expect((await markPortalPublishedManually(VACANCY, PORTAL, "ABC", "http://portal.test")).ok).toBe(false);
    expect((await markPortalPublishedManually(VACANCY, PORTAL, "ABC", `https://${"a".repeat(500)}`)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("devuelve el mensaje de la base de datos cuando la operación no se permite", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "RH409", message: "El robot gestiona la publicación de este portal" } });
    const result = await markPortalPublishedManually(VACANCY, PORTAL, "ABC");
    expect(result).toMatchObject({ ok: false, error: "El robot gestiona la publicación de este portal" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("marcar retirada a mano", () => {
  it("llama a la función y refresca la ficha", async () => {
    const result = await markPortalWithdrawnManually(PUBLICATION, VACANCY);
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("mark_portal_withdrawn_manually", { p_publication_id: PUBLICATION });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/vacantes/${VACANCY}`);
    expect(mocks.requirePermission).toHaveBeenCalledWith("vacancies:manage");
  });

  it("rechaza identificadores inválidos y propaga el error de la base de datos", async () => {
    expect((await markPortalWithdrawnManually("x", VACANCY)).ok).toBe(false);
    expect((await markPortalWithdrawnManually(PUBLICATION, "x")).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "RH409", message: "no se puede" } });
    expect((await markPortalWithdrawnManually(PUBLICATION, VACANCY)).ok).toBe(false);
  });
});
