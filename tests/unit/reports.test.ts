import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApplicationsCsv, csvCell, exportFilename, type ExportRow } from "@/modules/reports/csv";
import {
  computeFunnel,
  computeSources,
  computeTimes,
  type ReportApplication,
  type ReportStatusEvent,
} from "@/modules/reports/metrics";

const app = (id: string, status: ReportApplication["status"], source: ReportApplication["source"] = "manual", cand = id): ReportApplication => ({
  id,
  candidateId: cand,
  status,
  appliedAt: "2026-01-01T00:00:00Z",
  source,
});
const ev = (applicationId: string, fromStatus: ReportStatusEvent["fromStatus"], toStatus: ReportStatusEvent["toStatus"], createdAt: string): ReportStatusEvent => ({
  applicationId,
  fromStatus,
  toStatus,
  createdAt,
});

describe("csv", () => {
  it("escapa comillas, comas y saltos de línea", () => {
    expect(csvCell('Pérez, "Ana"')).toBe('"Pérez, ""Ana"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
  });

  it("neutraliza fórmulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("genera cabecera, BOM y filas", () => {
    const row: ExportRow = {
      candidateName: "Ana Ruiz",
      email: "ana@ejemplo.pe",
      phone: null,
      location: "Lima",
      source: "linkedin",
      status: "en_revision",
      appliedAt: "2026-03-05T10:00:00Z",
      level: "alta",
      score: 82.5,
      reviewStatus: "pendiente_revision",
    };
    const csv = buildApplicationsCsv([row, { ...row, level: null, score: null, reviewStatus: null }]);
    const lines = csv.replace("﻿", "").trimEnd().split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("Candidato,Correo,Teléfono,Ubicación,Fuente,Estado,Fecha de postulación,Nivel de compatibilidad,Puntaje (%),Revisión de RRHH");
    expect(lines[1]).toBe("Ana Ruiz,ana@ejemplo.pe,,Lima,LinkedIn,En revisión,2026-03-05,Cumple los requisitos,82.5,Pendiente de revisión");
    expect(lines[2]).toContain("Sin evaluar");
  });

  it("el nombre de archivo es ASCII", () => {
    expect(exportFilename("2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10", new Date("2026-05-01T00:00:00Z"))).toBe(
      "postulaciones-2b1c1f8e-2026-05-01.csv",
    );
  });
});

describe("métricas", () => {
  it("embudo: cuenta etapas alcanzadas y conversión", () => {
    const apps = [app("a", "nuevo"), app("b", "en_revision"), app("c", "seleccionado"), app("d", "no_seleccionado")];
    const events = [
      ev("c", "nuevo", "en_revision", "2026-01-02T00:00:00Z"),
      ev("c", "en_revision", "seleccionado", "2026-01-05T00:00:00Z"),
      ev("d", "nuevo", "en_revision", "2026-01-02T00:00:00Z"),
      ev("d", "en_revision", "no_seleccionado", "2026-01-03T00:00:00Z"),
    ];
    const funnel = computeFunnel(apps, events);
    const byStatus = Object.fromEntries(funnel.map((s) => [s.status, s]));
    expect(byStatus.nuevo.reached).toBe(4);
    expect(byStatus.en_revision.reached).toBe(3);
    expect(byStatus.en_revision.conversion).toBeCloseTo(0.75);
    expect(byStatus.seleccionado.reached).toBe(1);
    // Etapas no seleccionables sin datos no aparecen como filas fantasma.
    expect(byStatus.preseleccionado).toBeUndefined();
    expect(byStatus.en_evaluacion).toBeUndefined();
    expect(byStatus.entrevista_programada.reached).toBe(1);
    expect(byStatus.seleccionado.conversion).toBeCloseTo(1);
  });

  it("embudo: muestra una etapa antigua si tiene datos", () => {
    const funnel = computeFunnel([app("a", "preseleccionado")], []);
    expect(funnel.map((s) => s.status)).toContain("preseleccionado");
  });

  it("fuentes: candidatos distintos y porcentajes", () => {
    const rows = computeSources([
      app("a", "nuevo", "linkedin", "c1"),
      app("b", "nuevo", "linkedin", "c1"),
      app("c", "nuevo", "referido", "c2"),
    ]);
    expect(rows.map((r) => [r.source, r.candidates])).toEqual([
      ["linkedin", 1],
      ["referido", 1],
    ]);
    expect(rows[0].share).toBeCloseTo(0.5);
  });

  it("tiempos: por etapa y hasta la decisión", () => {
    const apps = [app("a", "seleccionado")];
    const events = [
      ev("a", "nuevo", "en_revision", "2026-01-02T00:00:00Z"), // 24 h en nuevo
      ev("a", "en_revision", "seleccionado", "2026-01-04T00:00:00Z"), // 48 h en revisión
    ];
    const times = computeTimes(apps, events);
    expect(times.perStage.find((t) => t.status === "nuevo")?.avgHours).toBe(24);
    expect(times.perStage.find((t) => t.status === "en_revision")?.avgHours).toBe(48);
    expect(times.toDecision?.avgHours).toBe(72);
  });

  it("tiempos: sin eventos no inventa datos", () => {
    const times = computeTimes([app("a", "nuevo")], []);
    expect(times.perStage).toEqual([]);
    expect(times.toDecision).toBeNull();
  });
});

// --- Ruta de exportación: autorización y auditoría --------------------------

const state = vi.hoisted(() => ({
  userId: null as string | null,
  role: "rrhh" as "admin" | "rrhh" | "reclutador_caleta",
  vacancyVisible: true,
  auditFails: false,
  calls: [] as string[],
  audit: [] as Record<string, unknown>[],
}));

const VACANCY = "2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10";

function query(table: string) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ["select", "eq", "in", "order", "range", "limit"]) q[m] = chain;
  q.maybeSingle = async () => {
    state.calls.push(`read:${table}`);
    if (table === "profiles") {
      return { data: { id: state.userId, full_name: "X", email: "x@x.pe", role: state.role, is_active: true }, error: null };
    }
    return { data: table === "vacancies" && state.vacancyVisible ? { id: VACANCY } : null, error: null };
  };
  q.then = (resolve: (v: unknown) => unknown) => {
    state.calls.push(`read:${table}`);
    const data =
      table === "application_overview"
        ? [{ id: "a1", candidate_id: "c1", candidate_name: "Ana Ruiz", candidate_email: "ana@ejemplo.pe", status: "nuevo", applied_at: "2026-01-01T00:00:00Z", level: "alta", score: 70, review_status: null }]
        : table === "candidates"
          ? [{ id: "c1", source: "linkedin", phone: "999", location: "Lima" }]
          : [];
    return resolve({ data, error: null });
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({ data: state.userId ? { claims: { sub: state.userId } } : null, error: null }),
    },
    from: (table: string) => query(table),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        state.calls.push(`insert:${table}`);
        if (state.auditFails) return { error: { code: "XX000" } };
        state.audit.push(row);
        return { error: null };
      },
    }),
  }),
}));

describe("GET /api/reportes/export", () => {
  beforeEach(() => {
    state.userId = "11111111-1111-4111-8111-111111111111";
    state.role = "rrhh";
    state.vacancyVisible = true;
    state.auditFails = false;
    state.calls.length = 0;
    state.audit.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  async function call(vacante: string | null = VACANCY) {
    const { GET } = await import("@/app/api/reportes/export/route");
    const { NextRequest } = await import("next/server");
    const url = `http://localhost/api/reportes/export${vacante === null ? "" : `?vacante=${vacante}`}`;
    return GET(new NextRequest(url));
  }

  it("rechaza sin sesión sin leer datos", async () => {
    state.userId = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(state.calls.filter((c) => !c.endsWith(":profiles"))).toEqual([]);
  });

  it("rechaza a quien no es personal de RRHH", async () => {
    state.role = "reclutador_caleta";
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.calls.some((c) => c.startsWith("insert:"))).toBe(false);
  });

  it("rechaza un identificador inválido", async () => {
    expect((await call("no-es-uuid")).status).toBe(400);
    expect((await call(null)).status).toBe(400);
  });

  it("404 si la vacante no es visible y no audita", async () => {
    state.vacancyVisible = false;
    expect((await call()).status).toBe(404);
    expect(state.audit).toEqual([]);
  });

  it("entrega el CSV con cabeceras de descarga y audita solo identificadores", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="postulaciones-.*\.csv"$/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).toContain("Ana Ruiz");

    expect(state.audit).toHaveLength(1);
    const entry = state.audit[0];
    expect(entry).toMatchObject({ action: "reporte_exportado", entity_type: "vacancies", entity_id: VACANCY });
    const serialized = JSON.stringify(entry);
    for (const personal of ["Ana Ruiz", "ana@ejemplo.pe", "999", "Lima"]) expect(serialized).not.toContain(personal);
  });

  it("si la auditoría falla, no entrega el archivo", async () => {
    state.auditFails = true;
    const res = await call();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("Content-Type")).not.toContain("text/csv");
  });
});
