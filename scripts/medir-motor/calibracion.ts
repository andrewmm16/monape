// Mide la CALIBRACIÓN del motor de afinidad sobre el banco de cv-prueba/.
//
// A diferencia de `main.ts` (que comprueba el ORDEN dentro de cada puesto), este
// script agrega los 32 CVs de los 8 puestos y mira cómo se separan los puntajes
// según la etiqueta de ajuste asignada a mano (muy_fuerte / bueno / medio /
// no_cumple). Responde: ¿un «muy fuerte» puntúa de forma consistentemente más
// alta que un «bueno», y este que un «medio»? ¿Dónde se pisan los buckets?
//
// SOLO MIDE: no toca el motor, el scoring ni los umbrales. Usa únicamente las
// etiquetas de ajuste que ya existen en datos.ts; no etiqueta nada nuevo.
//
// Extrae el texto real de los PDF con el mismo pipeline de la app
// (resumes/extraction-core.ts) y corre el motor vigente. Es determinista: no
// toca la base de datos, no llama a servicios externos ni necesita AI_API_KEY.
//
// Uso:
//   npm run calibrar:motor
//   npm run calibrar:motor -- --json > calibracion.json

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { RULE_ENGINE_VERSION } from "../../src/modules/evaluation/rule-engine";
import { SCORING_VERSION } from "../../src/modules/evaluation/scoring";
import { extractRawText } from "../../src/modules/resumes/extraction-core";
import type { CompatibilityLevel } from "../../src/modules/evaluation/types";
import { evaluarTexto, pad, padIzq } from "./evaluar";
import {
  ETIQUETA_AJUSTE,
  FECHA_REFERENCIA,
  ORDEN_AJUSTE,
  PUESTOS,
  type Ajuste,
  type CandidatoFixture,
  type PuestoFixture,
} from "./datos";

const RAIZ_CV = resolve(import.meta.dirname, "..", "..", "cv-prueba");

/** Buckets de mejor a peor, en el orden en que deberían separarse los puntajes. */
const BUCKETS: Ajuste[] = ["muy_fuerte", "bueno", "medio", "no_cumple"];

type Punto = {
  puesto: string;
  candidato: string;
  ajuste: Ajuste;
  score: number;
  nivel: CompatibilityLevel;
};

async function evaluarCandidato(puesto: PuestoFixture, candidato: CandidatoFixture): Promise<Punto> {
  const ruta = join(RAIZ_CV, puesto.carpeta, candidato.archivo);
  let bytes: Buffer;
  try {
    bytes = await readFile(ruta);
  } catch {
    throw new Error(`No se encontró ${ruta}\nRegenere los PDF con: npx tsx scripts/generar-cv-prueba.ts`);
  }
  const texto = await extractRawText(new Uint8Array(bytes), "pdf");
  const { score, nivel } = evaluarTexto(puesto, texto);
  return {
    puesto: puesto.titulo,
    candidato: candidato.nombre.split(" ").slice(-2).join(" "),
    ajuste: candidato.ajuste,
    score,
    nivel,
  };
}

type ResumenBucket = { ajuste: Ajuste; n: number; min: number; prom: number; max: number };

function resumirBucket(puntos: Punto[], ajuste: Ajuste): ResumenBucket | null {
  const scores = puntos.filter((p) => p.ajuste === ajuste).map((p) => p.score);
  if (scores.length === 0) return null;
  const suma = scores.reduce((a, b) => a + b, 0);
  return {
    ajuste,
    n: scores.length,
    min: Math.min(...scores),
    prom: Math.round((suma / scores.length) * 10) / 10,
    max: Math.max(...scores),
  };
}

/** Separación entre dos buckets adyacentes (mejor arriba de peor). */
type Brecha = {
  mejor: Ajuste;
  peor: Ajuste;
  /** min(mejor) - max(peor). ≥ 0 = separación limpia; < 0 = solapamiento. */
  brecha: number;
  /** Candidatos que causan el solapamiento, si lo hay. */
  culpables: string[];
};

function calcularBrechas(puntos: Punto[], resumenes: Map<Ajuste, ResumenBucket>): Brecha[] {
  const brechas: Brecha[] = [];
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const mejor = BUCKETS[i]!;
    const peor = BUCKETS[i + 1]!;
    const rMejor = resumenes.get(mejor);
    const rPeor = resumenes.get(peor);
    if (!rMejor || !rPeor) continue;
    const brecha = Math.round((rMejor.min - rPeor.max) * 100) / 100;
    const culpables: string[] = [];
    if (brecha < 0) {
      // El solape lo forman los «peor» que suben por encima del mínimo de «mejor»
      // y los «mejor» que caen por debajo del máximo de «peor».
      for (const p of puntos) {
        if (p.ajuste === peor && p.score >= rMejor.min) {
          culpables.push(`${p.candidato} (${ETIQUETA_AJUSTE[peor]}, ${p.score} % · ${p.puesto})`);
        } else if (p.ajuste === mejor && p.score <= rPeor.max) {
          culpables.push(`${p.candidato} (${ETIQUETA_AJUSTE[mejor]}, ${p.score} % · ${p.puesto})`);
        }
      }
    }
    brechas.push({ mejor, peor, brecha, culpables });
  }
  return brechas;
}

/** Niveles observados por bucket (alta / parcial / pendiente / …). */
function distribuirNiveles(puntos: Punto[]): { niveles: CompatibilityLevel[]; conteo: Map<Ajuste, Map<CompatibilityLevel, number>> } {
  const niveles = [...new Set(puntos.map((p) => p.nivel))];
  const conteo = new Map<Ajuste, Map<CompatibilityLevel, number>>();
  for (const ajuste of BUCKETS) conteo.set(ajuste, new Map());
  for (const p of puntos) {
    const porNivel = conteo.get(p.ajuste)!;
    porNivel.set(p.nivel, (porNivel.get(p.nivel) ?? 0) + 1);
  }
  return { niveles, conteo };
}

function imprimirInforme(puntos: Punto[]): boolean {
  const resumenes = new Map<Ajuste, ResumenBucket>();
  for (const ajuste of BUCKETS) {
    const r = resumirBucket(puntos, ajuste);
    if (r) resumenes.set(ajuste, r);
  }

  stdout.write(
    `Motor: ${RULE_ENGINE_VERSION} · scoring: ${SCORING_VERSION} · fecha de referencia: ${FECHA_REFERENCIA.toISOString().slice(0, 10)}\n`,
  );
  stdout.write(`Banco: ${puntos.length} CVs de ${PUESTOS.length} puestos. Solo mide; no cambia el motor.\n`);

  // A. Separación de puntajes por bucket (agregando los 8 puestos).
  stdout.write(`\n${"=".repeat(72)}\nA. Puntajes por ajuste asignado a mano (todos los puestos juntos)\n${"=".repeat(72)}\n\n`);
  stdout.write(`${pad("Ajuste", 22)}${padIzq("N", 4)}${padIzq("Mín", 8)}${padIzq("Prom", 8)}${padIzq("Máx", 8)}\n`);
  stdout.write(`${"-".repeat(72)}\n`);
  for (const ajuste of BUCKETS) {
    const r = resumenes.get(ajuste);
    if (!r) continue;
    stdout.write(
      `${pad(ETIQUETA_AJUSTE[ajuste], 22)}${padIzq(String(r.n), 4)}${padIzq(`${r.min} %`, 8)}${padIzq(`${r.prom} %`, 8)}${padIzq(`${r.max} %`, 8)}\n`,
    );
  }

  // B. Separación entre buckets adyacentes.
  const brechas = calcularBrechas(puntos, resumenes);
  stdout.write(`\n${"=".repeat(72)}\nB. Separación entre buckets adyacentes\n${"=".repeat(72)}\n\n`);
  let solapes = 0;
  for (const b of brechas) {
    const etq = `${ETIQUETA_AJUSTE[b.mejor]} → ${ETIQUETA_AJUSTE[b.peor]}`;
    if (b.brecha >= 0) {
      stdout.write(`  ${pad(etq, 40)} separación limpia de ${b.brecha} puntos\n`);
    } else {
      solapes++;
      stdout.write(`  ${pad(etq, 40)} SE PISAN ${Math.abs(b.brecha)} puntos\n`);
      for (const c of b.culpables) stdout.write(`      ! ${c}\n`);
    }
  }

  // C. Distribución de niveles por bucket.
  const { niveles, conteo } = distribuirNiveles(puntos);
  stdout.write(`\n${"=".repeat(72)}\nC. Niveles sugeridos por bucket\n${"=".repeat(72)}\n\n`);
  stdout.write(`${pad("Ajuste", 22)}${niveles.map((n) => padIzq(n, 12)).join("")}\n`);
  stdout.write(`${"-".repeat(72)}\n`);
  for (const ajuste of BUCKETS) {
    const porNivel = conteo.get(ajuste)!;
    const celdas = niveles.map((n) => padIzq(String(porNivel.get(n) ?? 0), 12)).join("");
    stdout.write(`${pad(ETIQUETA_AJUSTE[ajuste], 22)}${celdas}\n`);
  }

  // Veredicto.
  stdout.write(`\n${"=".repeat(72)}\nRESUMEN\n${"=".repeat(72)}\n\n`);
  if (solapes === 0) {
    stdout.write(`Los cuatro buckets se separan limpio: el puntaje ordena los ajustes sin pisarse.\n`);
  } else {
    stdout.write(
      `${solapes} frontera(s) entre buckets se solapan: el puntaje aún no separa esos ajustes con\n` +
        `un corte limpio. Son los candidatos marcados con «!» arriba; es el material del\n` +
        `siguiente paso (afinar términos y umbrales).\n`,
    );
  }
  stdout.write(`\nNota: comparar buckets entre puestos distintos es orientativo (cada puesto tiene su\ndificultad). La separación por puesto la sigue cubriendo npm run medir:motor.\n`);

  return solapes === 0;
}

async function main(): Promise<void> {
  const json = argv.slice(2).includes("--json");

  const puntos: Punto[] = [];
  for (const puesto of PUESTOS) {
    for (const candidato of puesto.candidatos) {
      puntos.push(await evaluarCandidato(puesto, candidato));
    }
  }

  if (json) {
    const resumenes = BUCKETS.map((a) => resumirBucket(puntos, a)).filter((r): r is ResumenBucket => r !== null);
    const brechas = calcularBrechas(puntos, new Map(resumenes.map((r) => [r.ajuste, r])));
    stdout.write(
      `${JSON.stringify(
        {
          motor: RULE_ENGINE_VERSION,
          scoring: SCORING_VERSION,
          fechaReferencia: FECHA_REFERENCIA.toISOString(),
          buckets: resumenes,
          brechas,
          puntos: [...puntos].sort((a, b) => ORDEN_AJUSTE[a.ajuste] - ORDEN_AJUSTE[b.ajuste]),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  imprimirInforme(puntos);
}

main().catch((error: unknown) => {
  stderr.write(`\n[calibrar-motor] ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
