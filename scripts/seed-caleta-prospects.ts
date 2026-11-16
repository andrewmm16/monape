/**
 * Carga en `caleta_prospects` la shortlist inicial de perfiles REALES y públicos
 * de LinkedIn localizados por sourcing (X-Ray), ya puntuados contra su vacante,
 * para arrancar la tabla del Reclutador Caleta.
 *
 *   npm run db:seed:caleta:prospects
 *
 * - Son perfiles públicos (nombre, titular, URL de LinkedIn). NO se inventan
 *   datos: el texto refleja lo observado en el perfil, con lo no confirmado
 *   marcado como «por verificar». No se cargan teléfonos ni correos (no se
 *   cosechan: se piden al contactar).
 * - Idempotente: omite un prospecto si ya existe esa URL de LinkedIn para la
 *   misma vacante. El origen del nombre es «extraido» (de perfil público).
 * - Puntúa con el MISMO motor determinista del panel (evaluateWithRules +
 *   assembleEvaluation), sin exigir criterios aprobados (pre-selección).
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY. Se niega a correr
 * contra un proyecto remoto salvo SEED_ALLOW_REMOTE=true, y nunca en producción.
 */
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

interface ProspectSeed {
  fullName: string;
  headline: string;
  location: string;
  linkedinUrl: string;
  /** Texto observado del perfil público; lo no confirmado va como «por verificar». */
  profileText: string;
}

/** Shortlist por título de vacante (coincide con seed-caleta-vacantes). */
const BY_VACANCY: Record<string, ProspectSeed[]> = {
  "Ingeniero Electromecánico": [
    {
      fullName: "Leonard Gutierrez",
      headline: "Ingeniero Mecánico Electricista — CUMBRA Ingeniería",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/lrgg1994",
      profileText:
        "Ingeniero Mecánico Electricista. Actualmente en CUMBRA Ingeniería (Lima). Perfil localizado por sourcing (LinkedIn X-Ray); posible perfil mid/junior. Años de experiencia y herramientas (AutoCAD, Revit MEP, DIALux) por verificar en el contacto.",
    },
    {
      fullName: "Emilio Contreras Melgar",
      headline: "Ingeniero Mecánico Electricista",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/contrerasemilio",
      profileText:
        "Ingeniero Mecánico Electricista, Lima. Perfil localizado por sourcing (LinkedIn X-Ray). Años de experiencia y manejo de AutoCAD por verificar en el contacto.",
    },
    {
      fullName: "Miguel Zelaya",
      headline: "Diseño mecánico-eléctrico (9+ años)",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/mgzd-aa32b251",
      profileText:
        "Ingeniero con más de 9 años en diseño mecánico y eléctrico (instalaciones eléctricas y mecánicas), Lima. Perfil localizado por sourcing (LinkedIn X-Ray); borderline por ser algo senior respecto al rango 2-5 años.",
    },
    {
      fullName: "Zeider Nieves Alvarez",
      headline: "Supervisión de proyectos (7+ años)",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/zeidernievesa",
      profileText:
        "Ingeniero con más de 7 años en supervisión de proyectos (minería e hidroeléctricas). Perfil localizado por sourcing (LinkedIn X-Ray); encaje con instalaciones eléctricas/mecánicas y herramientas por verificar.",
    },
    {
      fullName: "Ivan Aiquipa",
      headline: "Subestaciones eléctricas (15+ años)",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/ivanaiquipa",
      profileText:
        "Ingeniero con más de 15 años de experiencia en subestaciones eléctricas (media y baja tensión), Lima. Perfil localizado por sourcing (LinkedIn X-Ray); senior respecto al rango 2-5 años del puesto.",
    },
    {
      fullName: "Renzo Yauyo Ramos",
      headline: "Ingeniero Mecánico Electricista",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/renzo-yauyo-ramos-4344246a/",
      profileText:
        "Ingeniero Mecánico Electricista, Lima. Perfil localizado por sourcing (LinkedIn X-Ray). Encaje con instalaciones eléctricas en media y baja tensión, subestaciones y herramientas (AutoCAD, DIALux) por verificar al abrir su perfil.",
    },
    {
      fullName: "Germán Mendoza",
      headline: "Ingeniero Mecánico Eléctrico — Vertiv Perú",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/germ%C3%A1n-mendoza/",
      profileText:
        "Ingeniero Mecánico Eléctrico colegiado; trabaja en Vertiv Perú SAC con proyectos de líneas de transmisión en media tensión. Perfil localizado por sourcing (LinkedIn X-Ray). Subestaciones, tableros, AutoCAD y DIALux por verificar en su perfil.",
    },
  ],
  "Ingeniero Civil (Junior)": [
    {
      fullName: "Franco Albites",
      headline: "Ingeniero Civil (PUCP), PMP — ETABS/SAP2000",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/francalbites",
      profileText:
        "Ingeniero Civil (PUCP), PMP, con más de 10 años de experiencia; diplomado en diseño estructural con ETABS y SAP2000. Perfil localizado por sourcing (LinkedIn X-Ray); senior respecto al rango junior 1-4 años.",
    },
    {
      fullName: "Martin Gabriel Cossío García",
      headline: "Diseño estructural (12+ años)",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/mcossio",
      profileText:
        "Ingeniero Civil con más de 12 años en diseño estructural y cálculo estructural, Lima. Perfil localizado por sourcing (LinkedIn X-Ray); senior respecto al rango junior.",
    },
    {
      fullName: "Walter Sheen Paoli",
      headline: "Diseño estructural (25+ años), CIP",
      location: "Miraflores, Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/waltersheenpaoli",
      profileText:
        "Ingeniero Civil colegiado (CIP) con más de 25 años en diseño estructural, Miraflores (Lima). Perfil localizado por sourcing (LinkedIn X-Ray); muy senior respecto al rango junior.",
    },
    {
      fullName: "Christian Paul Santur Cunyarache",
      headline: "Ingeniero Civil",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/christiansantur",
      profileText:
        "Ingeniero Civil, Lima. Perfil localizado por sourcing (LinkedIn X-Ray). Años de experiencia, diseño estructural y herramientas (AutoCAD) por verificar en el contacto.",
    },
    {
      fullName: "Eder Alexis Chilón Zárate",
      headline: "Ingeniero Civil — contenido estructural",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/ederchilonzarate",
      profileText:
        "Ingeniero Civil con contenido de diseño estructural en su perfil. Localizado por sourcing (LinkedIn X-Ray). Años de experiencia y herramientas por verificar en el contacto.",
    },
    {
      fullName: "Ricardo Luna Torrejón",
      headline: "Ingeniero Civil Junior — DRA Global | PUCP",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/ricardolunat/",
      profileText:
        "Ingeniero Civil junior. Trabaja como Junior Civil Project Engineer en DRA Global y fue asistente de docencia (Teaching Assistant) en la PUCP. Perfil localizado por sourcing (LinkedIn X-Ray); encaja con el rango junior 1-4 años. Diseño estructural y herramientas (AutoCAD, ETABS) por confirmar al abrir su perfil.",
    },
    {
      fullName: "Christian Joel Yarlequé Yovera",
      headline: "Ingeniero Civil (UNP) — Coordinador BIM",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/christian-joel-yarlequ%C3%A9-yovera-8b4700196/",
      profileText:
        "Ingeniero Civil por la Universidad Nacional de Piura; actualmente Coordinador BIM en Consorcio Zane. Según su perfil público maneja SAP2000, ETABS y AutoCAD. Perfil localizado por sourcing (LinkedIn X-Ray); verificar años, ya que el rol de coordinación puede exceder el rango junior.",
    },
    {
      fullName: "Cristian Paucar",
      headline: "Ingeniero Civil",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/cristian-paucar-378937a3/",
      profileText:
        "Ingeniero Civil, Lima/Perú. Perfil localizado por sourcing (LinkedIn X-Ray). Años de experiencia, diseño estructural y herramientas (AutoCAD, ETABS) por verificar en su perfil.",
    },
  ],
  "Ingeniero Sanitario": [
    {
      fullName: "Pedro Iniesta Cabañero",
      headline: "Instalaciones sanitarias (y gas/eléctricas)",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/pjiniesta",
      profileText:
        "Ingeniero con experiencia en instalaciones sanitarias (también instalaciones de gas y eléctricas). Perfil localizado por sourcing (LinkedIn X-Ray). Años, AutoCAD y trámites SEDAPAL por verificar en el contacto.",
    },
    {
      fullName: "Antony Juan Albines Lozano",
      headline: "Ingeniero Civil (CIP) — contacto con SEDAPAL",
      location: "Lima, Perú",
      linkedinUrl: "https://pe.linkedin.com/in/antonyalbineslozano",
      profileText:
        "Ingeniero Civil colegiado (CIP) con conexiones en SEDAPAL. Perfil localizado por sourcing (LinkedIn X-Ray); borderline por ser civil (no sanitario). Encaje con instalaciones sanitarias por verificar.",
    },
    {
      fullName: "Fernando Garcia Saavedra",
      headline: "Especialista en Instalaciones Sanitarias — Consorcio San Nicolás",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/fernando-garcia-saavedra-2a411a54/",
      profileText:
        "Ingeniero Sanitario colegiado (CIP). Especialista en instalaciones sanitarias y sistemas de agua contra incendio en Lima (proyectos de aeropuerto y banca), con más de 9 años de experiencia. Perfil localizado por sourcing (LinkedIn X-Ray); senior respecto al rango 2-5 años, pero muy afín en instalaciones sanitarias y ACI. AutoCAD y trámites SEDAPAL por verificar.",
    },
    {
      fullName: "Eduardo Aldave Valerio",
      headline: "Ingeniero Sanitario — agua y saneamiento (RVC Contratistas)",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/eduardo-aldave-valerio-1664761b9/",
      profileText:
        "Ingeniero Sanitario por la UNI; especialista en agua y saneamiento, gerente de estudios y obras en RVC Contratistas, con formación en cálculo y selección de tuberías para obras de saneamiento (agua y desagüe). Perfil localizado por sourcing (LinkedIn X-Ray). Años exactos y AutoCAD por verificar.",
    },
    {
      fullName: "Marco Antonio Segami Borda",
      headline: "Ingeniero Sanitario — MS Ingenieros SAC",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/marco-antonio-segami-borda-7a430624/",
      profileText:
        "Ingeniero Sanitario con formación en la UNI; trabaja en MS Ingenieros SAC con proyectos en Lima. Perfil localizado por sourcing (LinkedIn X-Ray). Años de experiencia, instalaciones sanitarias, AutoCAD y trámites SEDAPAL por verificar en su perfil.",
    },
    {
      fullName: "Raúl Moisés Manturano Campos",
      headline: "Ingeniero Sanitario — instalaciones sanitarias (Consorcio Ucayali)",
      location: "Lima, Perú",
      linkedinUrl: "https://www.linkedin.com/in/ra%C3%BAl-mois%C3%A9s-manturano-campos-56baa560/",
      profileText:
        "Ingeniero Sanitario especializado en instalaciones sanitarias para edificaciones; actualmente en Consorcio Ucayali. Perfil localizado por sourcing (LinkedIn X-Ray). Años de experiencia, AutoCAD, ACI y cisternas por verificar en su perfil.",
    },
  ],
};

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
  let inserted = 0;
  let skipped = 0;

  for (const [title, prospects] of Object.entries(BY_VACANCY)) {
    const { data: vacancy, error: vErr } = await supabase
      .from("vacancies")
      .select("id")
      .eq("title", title)
      .limit(1)
      .maybeSingle();
    if (vErr) fail(`No se pudo buscar la vacante «${title}»: ${vErr.message}`);
    if (!vacancy) {
      console.log(`• Vacante «${title}» no existe aún (corre db:seed:caleta primero); se omite su shortlist.`);
      continue;
    }

    for (const p of prospects) {
      const { data: existing, error: exErr } = await supabase
        .from("caleta_prospects")
        .select("id")
        .eq("vacancy_id", vacancy.id)
        .eq("linkedin_url", p.linkedinUrl)
        .limit(1)
        .maybeSingle();
      if (exErr) fail(`No se pudo comprobar «${p.fullName}»: ${exErr.message}`);
      if (existing) {
        skipped += 1;
        continue;
      }

      const { score, detail } = await scoreFor(vacancy.id, p.profileText);
      const { error: insErr } = await supabase.from("caleta_prospects").insert({
        vacancy_id: vacancy.id,
        full_name: p.fullName,
        headline: p.headline,
        location: p.location,
        linkedin_url: p.linkedinUrl,
        source: "linkedin",
        source_detail: "X-Ray LinkedIn (sourcing inicial)",
        profile_text: p.profileText,
        field_origins: { full_name: "extraido" } as Json,
        status: "encontrado",
        score,
        score_detail: detail as unknown as Json,
        scoring_version: detail.scoringVersion,
        scored_at: new Date().toISOString(),
      });
      if (insErr) fail(`No se pudo insertar «${p.fullName}»: ${insErr.message}`);
      inserted += 1;
      console.log(`✔ ${title}: ${p.fullName} → ${score}%`);
    }
  }

  console.log(`\nShortlist cargada. Insertados: ${inserted}; omitidos (ya existían): ${skipped}.`);
  console.log("Abre /caleta para verlos puntuados. Verifica cada perfil antes de contactar.");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
