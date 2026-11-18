// Informe de aprendizaje (#19): dónde no coinciden el motor de reglas, la IA y lo que
// RRHH verificó después, con datos REALES de la base (no con el banco de prueba).
//
// Para cada postulación con evaluación del motor y segunda opinión con IA (mismo CV y
// criterios), compara requisito por requisito:
//   - qué duda tuvo el motor (se recalcula con el motor vigente sobre el texto guardado);
//   - si la IA coincidió;
//   - si RRHH lo verificó, a quién le dio la razón.
// Y propone reglas o sinónimos cuando RRHH confirma una y otra vez lo que el motor dejó
// en duda (p. ej. «asistente de residencia» para «supervisión de obras»).
//
// SOLO LEE. No muestra nombres ni datos de contacto: identifica cada postulación por el
// inicio de su id. Lee .env.local (NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY).
//
// Uso:
//   npm run informe:ia
//   npm run informe:ia -- --dias 30 --min 2 --salida informe.md

import { writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { evaluateWithRules, RULE_ENGINE_VERSION } from "../../src/modules/evaluation/rule-engine";
import type { Assessment, EngineSignal, ItemAssessment, RequirementInput } from "../../src/modules/evaluation/types";
import type { Database } from "../../src/types/database";

function opcion(nombre: string): string | undefined {
  const i = argv.indexOf(`--${nombre}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const DIAS = Number(opcion("dias") ?? 180);
/** Confirmaciones de RRHH a partir de las cuales se propone una regla o sinónimo. */
const MIN_CONFIRMACIONES = Number(opcion("min") ?? 2);
const SALIDA = opcion("salida");

type ItemRow = { evaluation_id: string; requirement_id: string | null; assessment: Assessment; cv_assessment: Assessment | null };

type Casilla = {
  app: string;
  vacante: string;
  requisito: string;
  duda: EngineSignal | "pendiente sin marca" | "sin evidencia" | "acreditado sin duda";
  motor: Assessment;
  ia: Assessment;
  rrhh: "acreditado" | "no_cumplido" | null;
  terminos: string[];
};

/** Valoración original del CV (antes de cualquier verificación de RRHH). */
const original = (item: ItemRow): Assessment => item.cv_assessment ?? item.assessment;

/** ¿El veredicto original es coherente con lo que RRHH comprobó? No acreditar algo que no se cumple es correcto. */
function acierta(veredicto: Assessment, rrhh: "acreditado" | "no_cumplido"): boolean {
  return rrhh === "acreditado" ? veredicto === "acreditado" : veredicto !== "acreditado";
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY (.env.local).");
    exit(1);
  }
  const db = createClient<Database>(url, key, { auth: { persistSession: false } });
  const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000).toISOString();

  const { data: evaluaciones, error } = await db
    .from("candidate_evaluations")
    .select("id, application_id, resume_id, criteria_version, method, created_at")
    .gte("created_at", desde)
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Pares (motor, IA) del mismo CV y criterios: la última de cada método.
  const pares = new Map<string, { reglas?: (typeof evaluaciones)[number]; ia?: (typeof evaluaciones)[number] }>();
  for (const e of evaluaciones) {
    const clave = `${e.application_id}|${e.resume_id}|${e.criteria_version}`;
    const par = pares.get(clave) ?? {};
    if (e.method === "reglas" && !par.reglas) par.reglas = e;
    if (e.method === "ia" && !par.ia) par.ia = e;
    pares.set(clave, par);
  }
  const completos = [...pares.values()].filter((p) => p.reglas && p.ia) as { reglas: (typeof evaluaciones)[number]; ia: (typeof evaluaciones)[number] }[];

  const lineas: string[] = [];
  const log = (s = "") => {
    lineas.push(s);
    console.log(s);
  };
  log(`# Motor, IA y RRHH: dónde no coinciden (últimos ${DIAS} días)`);
  log();
  log(`Dudas del motor recalculadas con ${RULE_ENGINE_VERSION} sobre el texto guardado de cada CV.`);
  log();
  if (completos.length === 0) {
    log("No hay postulaciones con evaluación del motor y segunda opinión con IA del mismo CV en ese periodo.");
    if (SALIDA) await writeFile(SALIDA, `${lineas.join("\n")}\n`, "utf8");
    return;
  }

  const casillas: Casilla[] = [];
  for (const { reglas, ia } of completos) {
    const [{ data: app }, { data: items }, { data: verificaciones }, { data: extraccion }] = await Promise.all([
      db.from("applications").select("vacancy_id, vacancies(title)").eq("id", reglas.application_id).single(),
      db.from("candidate_evaluation_items").select("evaluation_id, requirement_id, assessment, cv_assessment").in("evaluation_id", [reglas.id, ia.id]),
      db.from("requirement_verifications").select("requirement_id, result").eq("application_id", reglas.application_id),
      reglas.resume_id
        ? db.from("resume_extractions").select("raw_text, corrected_text").eq("resume_id", reglas.resume_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!app || !items) continue;
    const { data: reqRows } = await db
      .from("vacancy_requirements")
      .select("id, category, priority, description, keywords, weight, min_years, is_essential")
      .eq("vacancy_id", app.vacancy_id);
    const requisitos: RequirementInput[] = (reqRows ?? []).map((r) => ({
      id: r.id,
      category: r.category,
      priority: r.priority,
      description: r.description,
      keywords: r.keywords,
      weight: r.weight,
      minYears: r.min_years,
      isEssential: r.is_essential,
    }));
    const texto = (extraccion?.corrected_text ?? extraccion?.raw_text ?? "").trim();
    const motorAhora = new Map<string, ItemAssessment>(
      texto ? evaluateWithRules(texto, requisitos, { referenceDate: new Date(reglas.created_at) }).map((i) => [i.requirementId, i]) : [],
    );
    const rrhh = new Map((verificaciones ?? []).map((v) => [v.requirement_id, v.result as "acreditado" | "no_cumplido"]));
    const vacante = app.vacancies?.title ?? "(vacante)";

    for (const req of requisitos) {
      const m = items.find((i) => i.evaluation_id === reglas.id && i.requirement_id === req.id) as ItemRow | undefined;
      const a = items.find((i) => i.evaluation_id === ia.id && i.requirement_id === req.id) as ItemRow | undefined;
      if (!m || !a) continue;
      const recalculado = motorAhora.get(req.id);
      const motor = original(m);
      casillas.push({
        app: reglas.application_id.slice(0, 8),
        vacante,
        requisito: req.description,
        duda:
          recalculado?.signal ??
          (motor === "pendiente_verificacion" ? "pendiente sin marca" : motor === "sin_evidencia" ? "sin evidencia" : "acreditado sin duda"),
        motor,
        ia: original(a),
        rrhh: rrhh.get(req.id) ?? null,
        terminos: [...new Set((recalculado?.evidence ?? []).flatMap((e) => e.matched ?? []))],
      });
    }
  }

  const verificadas = casillas.filter((c) => c.rrhh);
  log(`Postulaciones con motor + IA: ${completos.length} · requisitos comparados: ${casillas.length} · verificados por RRHH: ${verificadas.length}`);
  log();
  log("## Por tipo de duda del motor");
  log();
  log("| Duda del motor | Requisitos | IA coincide | IA distinta | Verificados | RRHH da razón al motor | RRHH da razón a la IA |");
  log("|---|---:|---:|---:|---:|---:|---:|");
  const grupos = [...new Set(casillas.map((c) => c.duda))].sort();
  for (const g of grupos) {
    const cs = casillas.filter((c) => c.duda === g);
    const vs = cs.filter((c) => c.rrhh);
    log(
      `| ${g} | ${cs.length} | ${cs.filter((c) => c.ia === c.motor).length} | ${cs.filter((c) => c.ia !== c.motor).length} | ${vs.length} | ` +
        `${vs.filter((c) => acierta(c.motor, c.rrhh!)).length} | ${vs.filter((c) => acierta(c.ia, c.rrhh!)).length} |`,
    );
  }
  log();

  // Propuestas: RRHH acreditó varias veces lo que el motor dejó en duda por cargo/habilidad/errata.
  log(`## Propuestas de reglas o sinónimos (RRHH confirmó ${MIN_CONFIRMACIONES}+ veces una duda del motor)`);
  log();
  const conDudaConfirmada = verificadas.filter(
    (c) => c.rrhh === "acreditado" && (c.duda === "cargo_relacionado" || c.duda === "habilidad_relacionada" || c.duda === "posible_errata"),
  );
  const porPropuesta = new Map<string, Casilla[]>();
  for (const c of conDudaConfirmada) {
    for (const t of c.terminos.length > 0 ? c.terminos : ["(sin término registrado)"]) {
      const clave = `${c.requisito}|${t}`;
      porPropuesta.set(clave, [...(porPropuesta.get(clave) ?? []), c]);
    }
  }
  const propuestas = [...porPropuesta.entries()].filter(([, cs]) => cs.length >= MIN_CONFIRMACIONES).sort((a, b) => b[1].length - a[1].length);
  if (propuestas.length === 0) log("- (ninguna todavía)");
  for (const [clave, cs] of propuestas) {
    const [requisito, termino] = clave.split("|");
    log(`- «${termino}» para «${requisito}»: RRHH lo acreditó ${cs.length} veces (${cs[0]!.duda}). Considere agregarlo como palabra clave o sinónimo.`);
  }
  log();

  // Desacuerdos que todavía nadie verificó: lo que RRHH debería mirar primero.
  const abiertas = casillas.filter((c) => !c.rrhh && c.ia !== c.motor);
  log(`## Desacuerdos motor–IA sin verificar (${abiertas.length})`);
  log();
  for (const c of abiertas.slice(0, 50)) log(`- ${c.vacante} · postulación ${c.app}… · ${c.requisito}: motor ${c.motor} · IA ${c.ia} (${c.duda})`);
  if (abiertas.length > 50) log(`- … y ${abiertas.length - 50} más`);

  if (SALIDA) {
    await writeFile(SALIDA, `${lineas.join("\n")}\n`, "utf8");
    console.log(`\nInforme guardado en ${SALIDA}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});
