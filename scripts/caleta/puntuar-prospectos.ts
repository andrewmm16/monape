/**
 * Puntúa los prospectos recién cosechados y aplica el filtro de afinidad.
 *
 * Toma los prospectos con `status='encontrado'` y aún sin score (los que
 * inserta `procesar-cvs.mjs`), los puntúa con el MISMO motor determinista de la
 * app y aplica el gate acordado:
 *
 *   pasa = (todos los requisitos indispensables con evidencia positiva)
 *          Y (score de afinidad >= umbral, por defecto 40)
 *
 * Los aptos quedan `encontrado` (los contactará `enviar-whatsapp-caleta.mjs`,
 * que ya filtra por ese estado). Los que no pasan quedan `descartado`: no se
 * contactan y en la app caen en su propia sección, pero se conservan con su
 * score por si luego cambias los requisitos y quieres reconsiderarlos.
 *
 * No reimplementa nada: usa scoreProfileAgainstRequirements + loadVacancyRequirements
 * (src/modules/caleta/scoring.ts) y evaluarGateAfinidad (src/modules/caleta/gate.ts).
 *
 * Uso:
 *   npm run caleta:puntuar
 *   npm run caleta:puntuar -- --umbral=50
 *   npm run caleta:puntuar -- --dry                         # calcula y muestra, no escribe
 *   npm run caleta:puntuar -- --vacante="Ingeniero Civil (Junior)"
 *
 * Requiere .env.local con NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY.
 */
import { argv, env, exit, stdout } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../../src/types/database";
import {
  loadVacancyRequirements,
  scoreProfileAgainstRequirements,
} from "../../src/modules/caleta/scoring";
import { evaluarGateAfinidad, UMBRAL_AFINIDAD_DEFECTO } from "../../src/modules/caleta/gate";
import type { RequirementInput } from "../../src/modules/evaluation/types";

type Client = SupabaseClient<Database>;

function arg(nombre: string): string | undefined {
  return argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=").slice(1).join("=");
}

const dry = argv.includes("--dry");
const vacanteArg = arg("vacante");
const umbralArg = Number.parseInt(arg("umbral") ?? "", 10);
const umbral = Number.isFinite(umbralArg)
  ? umbralArg
  : Number.parseInt(env.CALETA_UMBRAL_AFINIDAD ?? "", 10) || UMBRAL_AFINIDAD_DEFECTO;

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) {
  stdout.write("✖ Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (configúralos en .env.local).\n");
  exit(1);
}
const supabase: Client = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Pendiente = {
  id: string;
  vacancy_id: string;
  full_name: string;
  profile_text: string | null;
};

/** Prospectos cosechados aún sin puntuar (score NULL), opcionalmente de una vacante. */
async function cargarPendientes(): Promise<Pendiente[]> {
  let vacancyIds: string[] | null = null;
  if (vacanteArg) {
    const { data, error } = await supabase.from("vacancies").select("id").eq("title", vacanteArg);
    if (error) throw error;
    vacancyIds = (data ?? []).map((v) => v.id);
    if (vacancyIds.length === 0) {
      stdout.write(`• No existe la vacante «${vacanteArg}».\n`);
      return [];
    }
  }

  let q = supabase
    .from("caleta_prospects")
    .select("id, vacancy_id, full_name, profile_text")
    .eq("status", "encontrado")
    .is("score", null);
  if (vacancyIds) q = q.in("vacancy_id", vacancyIds);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function titulosDeVacantes(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("vacancies").select("id, title").in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((v) => [v.id, v.title]));
}

async function main(): Promise<void> {
  stdout.write(
    `Umbral de afinidad: ${umbral}%  ·  Vacante: ${vacanteArg ?? "todas"}  ·  Dry: ${dry}\n`,
  );

  const pendientes = await cargarPendientes();
  if (pendientes.length === 0) {
    stdout.write("No hay prospectos pendientes de puntuar (status='encontrado' y score vacío).\n");
    return;
  }

  const titulos = await titulosDeVacantes([...new Set(pendientes.map((p) => p.vacancy_id))]);
  const requisitosPorVacante = new Map<string, RequirementInput[] | null>();
  const resumen = { procesados: 0, aptos: 0, descartados: 0, sinTexto: 0, errores: 0 };

  // Agrupa por vacante para cargar los requisitos una sola vez por vacante.
  const porVacante = new Map<string, Pendiente[]>();
  for (const p of pendientes) {
    const lista = porVacante.get(p.vacancy_id);
    if (lista) lista.push(p);
    else porVacante.set(p.vacancy_id, [p]);
  }

  for (const [vacancyId, grupo] of porVacante) {
    const titulo = titulos.get(vacancyId) ?? vacancyId;
    stdout.write(`\n========== ${titulo} (${grupo.length}) ==========\n`);

    if (!requisitosPorVacante.has(vacancyId)) {
      try {
        requisitosPorVacante.set(vacancyId, await loadVacancyRequirements(supabase, vacancyId));
      } catch (e) {
        requisitosPorVacante.set(vacancyId, null);
        stdout.write(`  ⚠️ Sin requisitos definidos, salto la vacante: ${(e as Error).message}\n`);
      }
    }
    const requisitos = requisitosPorVacante.get(vacancyId);
    if (!requisitos) continue;

    for (const p of grupo) {
      resumen.procesados++;
      const texto = (p.profile_text ?? "").trim();
      if (texto.length < 50) {
        resumen.sinTexto++;
        stdout.write(`  ⏭  ${p.full_name}: sin texto de perfil suficiente\n`);
        continue;
      }
      try {
        const { score, scoringVersion, detail } = scoreProfileAgainstRequirements(texto, requisitos);
        const gate = evaluarGateAfinidad(requisitos, detail, umbral);
        const nuevoEstado = gate.pasa ? "encontrado" : "descartado";
        if (gate.pasa) resumen.aptos++;
        else resumen.descartados++;

        const marca = gate.pasa ? "✔ apto    " : "✖ descarta";
        stdout.write(`  ${marca} ${String(score).padStart(3)}%  ${p.full_name}  — ${gate.motivo}\n`);

        if (!dry) {
          const { error } = await supabase
            .from("caleta_prospects")
            .update({
              score,
              score_detail: detail as unknown as Json,
              scoring_version: scoringVersion,
              scored_at: new Date().toISOString(),
              status: nuevoEstado,
              notes: gate.motivo,
            })
            .eq("id", p.id);
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        resumen.errores++;
        stdout.write(`  ⚠️ ${p.full_name}: ${(e as Error).message}\n`);
      }
    }
  }

  stdout.write("\n========== RESUMEN ==========\n");
  stdout.write(JSON.stringify(resumen, null, 2) + "\n");
  if (dry) stdout.write("(dry: no se escribió nada en la base)\n");
}

main().catch((e) => {
  stdout.write(`FATAL: ${e instanceof Error ? e.message : String(e)}\n`);
  exit(1);
});
