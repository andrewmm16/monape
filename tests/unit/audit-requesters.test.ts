import { describe, expect, it } from "vitest";
import { orderRef, pickRequester, type OrderRequest, type RobotEntry } from "@/modules/audit/requesters";

const PUB = "3f2b8a52-6c1e-4d0a-9b1f-0a1b2c3d4e5f";
const OTHER_PUB = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ANA = "11111111-1111-4111-8111-111111111111";
const LUIS = "22222222-2222-4222-8222-222222222222";

const robot = (action: string, at: string, over: Partial<RobotEntry> = {}): RobotEntry => ({
  actor_id: null,
  action,
  entity_type: "portal_publications",
  entity_id: PUB,
  metadata: {},
  created_at: at,
  ...over,
});
const request = (action: string, actor: string | null, at: string, entity = PUB): OrderRequest => ({
  entity_id: entity,
  action,
  actor_id: actor,
  created_at: at,
});

describe("pickRequester", () => {
  it("empareja la publicación del robot con quien la pidió", () => {
    const requests = [request("publicacion_portal_solicitada", ANA, "2026-10-30T10:00:00Z")];
    expect(pickRequester(robot("publicacion_portal_publicada", "2026-10-30T10:10:00Z"), requests)).toBe(ANA);
  });

  it("para un retiro usa la orden de retiro, no la de publicar", () => {
    const requests = [
      request("publicacion_portal_solicitada", ANA, "2026-10-30T10:00:00Z"),
      request("publicacion_portal_retiro", LUIS, "2026-10-30T11:00:00Z"),
    ];
    expect(pickRequester(robot("publicacion_portal_retirada", "2026-10-30T11:05:00Z"), requests)).toBe(LUIS);
  });

  it("toma la orden más reciente anterior a la acción y descarta las posteriores", () => {
    const requests = [
      request("publicacion_portal_solicitada", ANA, "2026-10-29T09:00:00Z"),
      request("publicacion_portal_solicitada", LUIS, "2026-10-30T09:00:00Z"),
      request("publicacion_portal_solicitada", ANA, "2026-10-31T09:00:00Z"),
    ];
    expect(pickRequester(robot("publicacion_portal_publicada", "2026-10-30T10:00:00Z"), requests)).toBe(LUIS);
  });

  it("ante un error acepta cualquiera de las dos órdenes", () => {
    const requests = [
      request("publicacion_portal_solicitada", ANA, "2026-10-30T10:00:00Z"),
      request("publicacion_portal_retiro", LUIS, "2026-10-30T11:00:00Z"),
    ];
    expect(pickRequester(robot("publicacion_portal_error", "2026-10-30T11:05:00Z"), requests)).toBe(LUIS);
  });

  it("ignora órdenes de otra publicación o sin persona", () => {
    const requests = [
      request("publicacion_portal_solicitada", ANA, "2026-10-30T10:00:00Z", OTHER_PUB),
      request("publicacion_portal_solicitada", null, "2026-10-30T10:00:00Z"),
    ];
    expect(pickRequester(robot("publicacion_portal_publicada", "2026-10-30T10:10:00Z"), requests)).toBeNull();
  });

  it("para una postulación traída por el robot usa la publicación de origen", () => {
    const entry = robot("integracion_postulacion", "2026-10-30T12:00:00Z", {
      entity_type: "applications",
      entity_id: "44444444-4444-4444-8444-444444444444",
      metadata: { publication_id: PUB },
    });
    const requests = [request("publicacion_portal_solicitada", ANA, "2026-10-30T10:00:00Z")];
    expect(pickRequester(entry, requests)).toBe(ANA);
  });
});

describe("orderRef", () => {
  it("no aplica a acciones hechas por una persona ni a datos inválidos", () => {
    expect(orderRef(robot("publicacion_portal_publicada", "2026-10-30T10:00:00Z", { actor_id: ANA }))).toBeNull();
    expect(orderRef(robot("publicacion_portal_publicada", "2026-10-30T10:00:00Z", { entity_id: "../x" }))).toBeNull();
    expect(
      orderRef(robot("integracion_postulacion", "2026-10-30T10:00:00Z", { entity_type: "applications", metadata: null })),
    ).toBeNull();
    expect(orderRef(robot("carga_masiva", "2026-10-30T10:00:00Z", { entity_type: "applications" }))).toBeNull();
  });
});
