import { describe, expect, it } from "vitest";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { searchTalentPool } from "@/modules/talent-pool/queries";
import { talentFiltersSchema } from "@/modules/talent-pool/schema";
import { accentInsensitivePattern, normalizeName, splitSkills } from "@/modules/talent-pool/text";

/** Cliente falso: registra las llamadas del query builder y responde según la tabla. */
function fakeClient(tables: Record<string, unknown[]>) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const chain: unknown = new Proxy(
        {},
        {
          get(_t, op: string) {
            if (op === "then") {
              return (resolve: (v: unknown) => void) =>
                resolve({ data: tables[table] ?? [], error: null, count: (tables[table] ?? []).length });
            }
            return (...args: unknown[]) => {
              calls.push({ table, op, args });
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
  return { client: client as unknown as AppSupabaseClient, calls };
}

const base = talentFiltersSchema.parse({});

describe("talent-pool helpers", () => {
  it("el patron es literal, en minusculas y sin comodines de vocales", () => {
    expect(accentInsensitivePattern("Ana")).toBe("%ana%");
    expect(accentInsensitivePattern("Excel")).toBe("%excel%");
    expect(accentInsensitivePattern("INGENIERÍA")).toBe("%ingeniería%");
    // Limitación conocida: no iguala tildes distintas.
    expect(accentInsensitivePattern("cafe")).not.toBe(accentInsensitivePattern("café"));
    expect(accentInsensitivePattern("%_")).toBe("");
    expect(accentInsensitivePattern("  ")).toBe("");
  });
  it("normaliza nombres y habilidades", () => {
    expect(normalizeName("José Núñez")).toBe("jose nunez");
    expect(splitSkills("Excel, sql,, Excel")).toEqual(["Excel", "sql"]);
  });
  it("descarta filtros invalidos", () => {
    const f = talentFiltersSchema.parse({ source: "x", status: "y", page: "-3" });
    expect(f.source).toBeUndefined();
    expect(f.status).toBeUndefined();
    expect(f.page).toBe(1);
  });
});

describe("searchTalentPool", () => {
  it("filtra por habilidad y restringe candidatos a esos ids", async () => {
    const { client, calls } = fakeClient({
      candidate_profile_items: [{ candidate_id: "a" }, { candidate_id: "a" }],
      candidates: [],
    });
    await searchTalentPool(client, { ...base, skills: "Excel" });
    expect(calls.find((c) => c.table === "candidate_profile_items" && c.op === "or")).toBeTruthy();
    expect(calls.find((c) => c.table === "candidates" && c.op === "in")?.args).toEqual(["id", ["a"]]);
  });
  it("sin coincidencias de habilidad no consulta candidatos", async () => {
    const { client, calls } = fakeClient({ candidate_profile_items: [] });
    const r = await searchTalentPool(client, { ...base, skills: "cobol" });
    expect(r).toEqual({ rows: [], total: 0 });
    expect(calls.some((c) => c.table === "candidates")).toBe(false);
  });
  it("el texto busca en nombre normalizado y en el CV", async () => {
    const { client, calls } = fakeClient({
      resume_extractions: [{ resumes: { candidate_id: "z", is_current: true } }],
    });
    await searchTalentPool(client, { ...base, q: "José" });
    const or = calls.find((c) => c.table === "candidates" && c.op === "or");
    expect(or?.args[0]).toBe("name_normalized.ilike.%jose%,id.in.(z)");
  });
  it("aplica fuente, ubicacion y estado", async () => {
    const { client, calls } = fakeClient({ candidates: [] });
    await searchTalentPool(client, { ...base, source: "linkedin", location: "Lima", status: "en_reserva" });
    const ops = calls.filter((c) => c.table === "candidates");
    expect(ops.find((c) => c.op === "eq" && c.args[0] === "source")).toBeTruthy();
    expect(ops.find((c) => c.op === "ilike" && c.args[0] === "location")).toBeTruthy();
    expect(ops.find((c) => c.op === "eq" && c.args[0] === "filter_apps.status")?.args[1]).toBe("en_reserva");
  });
});
