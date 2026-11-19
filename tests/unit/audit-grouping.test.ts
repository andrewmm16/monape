import { describe, expect, it } from "vitest";
import { describeAuditGroup, groupAuditRows, groupTimeRange, type GroupableRow } from "@/modules/audit/grouping";

let counter = 0;
function row(over: Partial<GroupableRow> = {}): GroupableRow {
  counter += 1;
  return {
    id: `id-${counter}`,
    actor_id: null,
    actor_name: "Robot / sistema",
    action: "update",
    entity_type: "ai_evaluation_jobs",
    created_at: "2026-11-19T15:12:00Z",
    ...over,
  };
}
const person = (over: Partial<GroupableRow> = {}) => row({ actor_id: "u1", actor_name: "Ana", entity_type: "applications", ...over });

describe("groupAuditRows", () => {
  it("devuelve lista vacía sin entradas", () => {
    expect(groupAuditRows([])).toEqual([]);
  });

  it("agrupa entradas seguidas del sistema sobre el mismo tipo de registro", () => {
    const rows = [row(), row(), row()];
    const items = groupAuditRows(rows);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "group", entityType: "ai_evaluation_jobs", actorName: "Robot / sistema" });
    expect(items[0].kind === "group" && items[0].rows).toEqual(rows);
  });

  it("no agrupa una entrada sola del sistema", () => {
    expect(groupAuditRows([row()]).map((i) => i.kind)).toEqual(["single"]);
  });

  it("nunca agrupa a las personas, aunque se repitan", () => {
    const items = groupAuditRows([person(), person(), person()]);
    expect(items.map((i) => i.kind)).toEqual(["single", "single", "single"]);
  });

  it("una persona en medio corta la racha", () => {
    const items = groupAuditRows([row(), row(), person(), row(), row()]);
    expect(items.map((i) => i.kind)).toEqual(["group", "single", "group"]);
  });

  it("cambiar de tipo de registro o de actor abre otro grupo", () => {
    const items = groupAuditRows([
      row(),
      row(),
      row({ entity_type: "resume_extractions" }),
      row({ entity_type: "resume_extractions" }),
      row({ entity_type: "resume_extractions", actor_name: "Robot de portales" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["group", "group", "single"]);
  });

  it("conserva el orden y no pierde entradas", () => {
    const rows = [row(), row(), person(), row(), row({ entity_type: "profiles" }), row({ entity_type: "profiles" })];
    const flat = groupAuditRows(rows).flatMap((i) => (i.kind === "single" ? [i.row] : i.rows));
    expect(flat).toEqual(rows);
  });
});

describe("describeAuditGroup", () => {
  it("redacta cuántas y qué hizo el sistema", () => {
    const rows = Array.from({ length: 30 }, () => row());
    expect(describeAuditGroup({ rows, entityType: "ai_evaluation_jobs", actorName: "Robot / sistema" })).toBe(
      "El sistema actualizó 30 evaluaciones con IA",
    );
  });

  it("nombra al robot de portales", () => {
    const rows = [row({ action: "publicacion_portal_publicada", entity_type: "portal_publications" }), row({ action: "publicacion_portal_publicada", entity_type: "portal_publications" })];
    expect(describeAuditGroup({ rows, entityType: "portal_publications", actorName: "Robot de portales" })).toBe(
      "El robot de portales registró cambios en 2 publicaciones en portales",
    );
  });

  it("con acciones mezcladas usa una fórmula neutra", () => {
    const rows = [row({ action: "insert" }), row({ action: "update" })];
    expect(describeAuditGroup({ rows, entityType: "ai_evaluation_jobs", actorName: "Robot / sistema" })).toBe(
      "El sistema registró cambios en 2 evaluaciones con IA",
    );
  });
});

describe("groupTimeRange", () => {
  it("da el rango de horas de Lima el mismo día", () => {
    // 15:12Z y 15:15Z son 10:12 y 10:15 en Lima (UTC-5).
    const rows = [{ created_at: "2026-11-19T15:15:00Z" }, { created_at: "2026-11-19T15:13:00Z" }, { created_at: "2026-11-19T15:12:00Z" }];
    expect(groupTimeRange(rows)).toBe("entre 10:12 y 10:15");
  });

  it("si todo cae en el mismo minuto, da una sola hora", () => {
    expect(groupTimeRange([{ created_at: "2026-11-19T15:12:10Z" }, { created_at: "2026-11-19T15:12:50Z" }])).toBe("a las 10:12");
  });

  it("devuelve null si abarca varios días de Lima", () => {
    expect(groupTimeRange([{ created_at: "2026-11-20T06:00:00Z" }, { created_at: "2026-11-19T15:00:00Z" }])).toBeNull();
  });
});
