/**
 * Verificación rápida de las consultas nuevas (pool de talento y reportes)
 * contra la BD local, para cazar errores de sintaxis PostgREST sin navegador.
 *
 *   npx tsx --conditions=react-server --env-file-if-exists=.env.local scripts/verificar-queries.ts
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";
import { searchTalentPool } from "../src/modules/talent-pool/queries";
import { talentFiltersSchema } from "../src/modules/talent-pool/schema";
import { getReport, getVacancyExportRows } from "../src/modules/reports/queries";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY");

const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
// Nota: usa service key (salta RLS). Aquí solo probamos que la SINTAXIS de la
// consulta no reviente en PostgREST; la RLS ya está cubierta por lectura/tests.
const sb = supabase as never;
const f = (o: Record<string, unknown> = {}) => talentFiltersSchema.parse(o);

async function run(name: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn();
    const s = JSON.stringify(r);
    console.log(`OK   ${name}  ->  ${s.length > 100 ? s.slice(0, 100) + "..." : s}`);
  } catch (e) {
    console.error(`FAIL ${name}  ->  ${(e as Error).message}`);
  }
}

async function main() {
  const { data: vacs } = await supabase.from("vacancies").select("id, title").limit(5);
  console.log("Vacantes en BD:", (vacs ?? []).map((v) => v.title));

  await run("pool sin filtros", () => searchTalentPool(sb, f({})));
  await run("pool q=react", () => searchTalentPool(sb, f({ q: "react" })));
  await run("pool skills=React", () => searchTalentPool(sb, f({ skills: "React" })));
  await run("pool status=nuevo (doble embed applications)", () => searchTalentPool(sb, f({ status: "nuevo" })));
  await run("pool status+skills+loc", () => searchTalentPool(sb, f({ status: "seleccionado", skills: "Excel", location: "Lima" })));

  await run("reporte global", () => getReport(sb, {}));
  if (vacs?.[0]) {
    await run("reporte por vacante", () => getReport(sb, { vacante: vacs[0].id }));
    await run("csv export de vacante", () => getVacancyExportRows(sb, vacs[0].id));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
