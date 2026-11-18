/**
 * Importa prospectos enriquecidos (JSON generado por el recolector Caleta) a
 * la tabla `caleta_prospects`, resolviendo la vacante por título y puntuando
 * con el mismo motor determinista que `seed-caleta-prospects.ts`.
 *
 *   npm run caleta:importar [-- --file=<ruta/al/caleta_prospects_import.json>]
 *
 * Por defecto lee scripts/caleta/salida/caleta_prospects_import.json. Idempotente:
 * omite un prospecto si ya existe esa URL de LinkedIn para la misma vacante.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assembleEvaluation } from "../src/modules/evaluation/assemble";
import { evaluateWithRules, RULE_ENGINE_VERSION } from "../src/modules/evaluation/rule-engine";
import type { RequirementInput } from "../src/modules/evaluation/types";
import type { Database, Json } from "../src/types/database";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) fail("Defina NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY (por ejemplo en .env.local).");
if (process.env.APP_ENV === "production") fail("No se cargan datos de prueba en producción.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1"].includes(host) && process.env.SEED_ALLOW_REMOTE !== "true") {
  fail(`El proyecto ${host} no es local. Use SEED_ALLOW_REMOTE=true solo si de verdad quiere escribir ahí.`);
}

const supabase = createClient<Database>(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface EnrichedProspect {
  vacanteTitulo: string;
  fullName: string;
  headline: string;
  location: string | null;
  linkedinUrl: string;
  source: "linkedin" | "cip" | "grupo" | "google" | "referido" | "otro";
  sourceDetail: string;
  profileText: string;
  email: string | null;
  phone: string | null;
  metadata?: {
    score_pre?: number;
    matched?: string[];
    missing?: string[];
    aniosDetectados?: number | null;
    rangoFit?: string;
    emailEsInferido?: boolean;
  };
}

// Salida del recolector (scripts/caleta/recolector-caleta.mjs), ignorada por git.
const defaultFile = path.resolve(import.meta.dirname, "caleta", "salida", "caleta_prospects_import.json");
const fileArg = process.argv.find((a) => a.startsWith("--file="))?.split("=")[1];
const filePath = fileArg ? path.resolve(fileArg) : defaultFile;
if (!fs.existsSync(filePath)) fail(`No existe el archivo ${filePath}`);
const prospects: EnrichedProspect[] = JSON.parse(fs.readFileSync(filePath, "utf8"));
console.log(`Leyendo ${prospects.length} prospectos desde ${filePath}`);

async function scoreFor(vacancyId: string, profileText: string) {
  const { data: rows, error } = await supabase
    .from("vacancy_requirements")
    .select("id, category, priority, description, keywords, weight, min_years, is_essential")
    .eq("vacancy_id", vacancyId)
    .order("position")
    .order("created_at");
  if (error) fail(`No se pudieron cargar los requisitos: ${error.message}`);
  if (!rows?.length) fail("La vacante no tiene requisitos definidos.");

  const requirements: RequirementInput[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    priority: r.priority,
    description: r.description,
    keywords: r.keywords,
    weight: r.weight,
    minYears: r.min_years,
    isEssential: r.is_essential,
  }));

  const items = evaluateWithRules(profileText, requirements);
  const detail = assembleEvaluation({
    method: "reglas",
    methodVersion: RULE_ENGINE_VERSION,
    model: null,
    requirements,
    items,
    textWasCorrected: false,
    textTruncated: false,
  });
  return { score: Math.round(detail.scores.score), detail };
}

async function main() {
  // Cache de vacantes por título
  const vacanciesByTitle = new Map<string, string>();
  for (const title of [...new Set(prospects.map((p) => p.vacanteTitulo))]) {
    const { data: vacancy, error } = await supabase
      .from("vacancies")
      .select("id")
      .eq("title", title)
      .limit(1)
      .maybeSingle();
    if (error) fail(`No se pudo buscar «${title}»: ${error.message}`);
    if (!vacancy) {
      console.log(`• «${title}» no existe en vacancies; sus prospectos se omiten. Corra db:seed:caleta antes.`);
      continue;
    }
    vacanciesByTitle.set(title, vacancy.id);
  }

  let inserted = 0;
  let skipped = 0;

  for (const p of prospects) {
    const vacancyId = vacanciesByTitle.get(p.vacanteTitulo);
    if (!vacancyId) {
      skipped += 1;
      continue;
    }

    const { data: existing, error: exErr } = await supabase
      .from("caleta_prospects")
      .select("id, email, field_origins")
      .eq("vacancy_id", vacancyId)
      .eq("linkedin_url", p.linkedinUrl)
      .limit(1)
      .maybeSingle();
    if (exErr) fail(`No se pudo comprobar «${p.fullName}»: ${exErr.message}`);
    if (existing) {
      // El esquema solo acepta origen "declarado" | "extraido" | "verificado".
      // Correos inferidos por patrón NO se persisten (no son evidencia): quedan
      // en el CSV del sourcing y RRHH decide si llamar. Solo subimos correos
      // con origen comprobable (no inferido).
      if (!existing.email && p.email && !p.metadata?.emailEsInferido) {
        const nuevosOrigins = {
          ...(existing.field_origins as Record<string, string>),
          email: "extraido",
        };
        const { error: updErr } = await supabase
          .from("caleta_prospects")
          .update({ email: p.email, field_origins: nuevosOrigins as unknown as Json })
          .eq("id", existing.id);
        if (updErr) fail(`No se pudo actualizar «${p.fullName}»: ${updErr.message}`);
        console.log(`  ↻ enriquecido ${p.fullName}: email ${p.email}`);
      } else if (p.email && p.metadata?.emailEsInferido) {
        console.log(`  (ya existía) ${p.fullName}  — correo inferido ${p.email} queda en CSV, no se sube`);
      } else {
        console.log(`  (ya existía, sin cambios) ${p.fullName}`);
      }
      skipped += 1;
      continue;
    }

    const { score, detail } = await scoreFor(vacancyId, p.profileText);

    const fieldOrigins: Record<string, "declarado" | "extraido" | "inferido"> = {
      full_name: "extraido",
    };
    if (p.email) fieldOrigins.email = p.metadata?.emailEsInferido ? "inferido" : "extraido";

    const { error: insErr } = await supabase.from("caleta_prospects").insert({
      vacancy_id: vacancyId,
      full_name: p.fullName,
      headline: p.headline,
      location: p.location,
      linkedin_url: p.linkedinUrl,
      source: p.source,
      source_detail: p.sourceDetail,
      profile_text: p.profileText,
      email: p.email,
      phone: p.phone,
      field_origins: fieldOrigins as unknown as Json,
      status: "encontrado",
      score,
      score_detail: detail as unknown as Json,
      scoring_version: detail.scoringVersion,
      scored_at: new Date().toISOString(),
    });
    if (insErr) fail(`No se pudo insertar «${p.fullName}»: ${insErr.message}`);
    inserted += 1;
    console.log(`✔ ${p.vacanteTitulo}: ${p.fullName} → ${score}% (pre-score ${p.metadata?.score_pre ?? "-"}%)`);
  }

  console.log(`\nImport terminado. Insertados: ${inserted}; omitidos: ${skipped}.`);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
