// Mide la PRECISIÓN del motor requisito por requisito contra la vara (gold-standard.ts).
//
// Para cada casilla (CV × requisito) compara el veredicto del motor con el
// veredicto correcto de la vara y reporta:
//   A. Matriz de confusión (vara × motor) sobre las casillas firmes.
//   B. Precisión y recall por tipo de veredicto.
//   C. SOBRE-ACREDITACIÓN: el motor acreditó algo que la vara NO da por pleno.
//   D. MÉRITO PERDIDO: la vara acredita algo que el motor descartó o no vio.
//   E. Casillas marcadas `revisar` (fuera de métricas), con lo que dijo el motor,
//      para el visto bueno de Omar.
//
// SOLO MIDE: no toca el motor, el scoring ni los umbrales. Mismo pipeline de
// extracción y evaluación que el resto del banco (evaluar.ts). Determinista.
//
// Uso:
//   npm run gold:motor
//   npm run gold:motor -- --json > gold.json

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { RULE_ENGINE_VERSION } from "../../src/modules/evaluation/rule-engine";
import { SCORING_VERSION } from "../../src/modules/evaluation/scoring";
import { extractRawText } from "../../src/modules/resumes/extraction-core";
import type { Assessment } from "../../src/modules/evaluation/types";
import { evaluarTexto, pad, padIzq, apellidos } from "./evaluar";
import { FECHA_REFERENCIA, PUESTOS } from "./datos";
import { GOLD, type GoldCell } from "./gold-standard";

const RAIZ_CV = resolve(import.meta.dirname, "..", "..", "cv-prueba");

/** Orden de los veredictos en la matriz, de mejor a peor cobertura. */
const CLASES: Assessment[] = ["acreditado", "pendiente_verificacion", "sin_evidencia", "no_cumplido"];
const ETIQUETA: Record<Assessment, string> = {
  acreditado: "acreditado",
  pendiente_verificacion: "pendiente",
  sin_evidencia: "sin evidencia",
  no_cumplido: "no cumplido",
};

type Casilla = {
  puesto: string;
  candidato: string;
  reqId: string;
  reqCorto: string;
  gold: GoldCell;
  motor: Assessment;
};

async function casillasDeCandidato(
  puestoTitulo: string,
  carpeta: string,
  requisitos: { id: string; corto: string }[],
  evaluar: (texto: string) => Map<string, { assessment: Assessment }>,
  archivo: string,
  nombre: string,
): Promise<Casilla[]> {
  const ruta = join(RAIZ_CV, carpeta, archivo);
  let bytes: Buffer;
  try {
    bytes = await readFile(ruta);
  } catch {
    throw new Error(`No se encontró ${ruta}\nRegenere los PDF con: npx tsx scripts/generar-cv-prueba.ts`);
  }
  const texto = await extractRawText(new Uint8Array(bytes), "pdf");
  const porRequisito = evaluar(texto);
  const goldCandidato = GOLD[archivo];
  if (!goldCandidato) throw new Error(`La vara no tiene al candidato ${archivo}`);

  const casillas: Casilla[] = [];
  for (const req of requisitos) {
    const gold = goldCandidato[req.id];
    if (!gold) throw new Error(`La vara no tiene la casilla ${archivo} · ${req.id}`);
    const item = porRequisito.get(req.id);
    if (!item) throw new Error(`El motor no valoró ${archivo} · ${req.id}`);
    casillas.push({
      puesto: puestoTitulo,
      candidato: apellidos(nombre),
      reqId: req.id,
      reqCorto: req.corto,
      gold,
      motor: item.assessment,
    });
  }
  return casillas;
}

type Metrica = { clase: Assessment; tp: number; fp: number; fn: number; precision: number | null; recall: number | null };

function calcularMetricas(firmes: Casilla[]): Metrica[] {
  return CLASES.map((clase) => {
    let tp = 0,
      fp = 0,
      fn = 0;
    for (const c of firmes) {
      const goldC = c.gold.assessment === clase;
      const motorC = c.motor === clase;
      if (goldC && motorC) tp++;
      else if (!goldC && motorC) fp++;
      else if (goldC && !motorC) fn++;
    }
    return {
      clase,
      tp,
      fp,
      fn,
      precision: tp + fp === 0 ? null : Math.round((tp / (tp + fp)) * 1000) / 10,
      recall: tp + fn === 0 ? null : Math.round((tp / (tp + fn)) * 1000) / 10,
    };
  });
}

function pct(n: number | null): string {
  return n === null ? "  n/a" : `${padIzq(String(n), 4)}%`;
}

function imprimirInforme(casillas: Casilla[]): boolean {
  const firmes = casillas.filter((c) => !c.gold.revisar);
  const revisar = casillas.filter((c) => c.gold.revisar);

  stdout.write(
    `Motor: ${RULE_ENGINE_VERSION} · scoring: ${SCORING_VERSION} · fecha de referencia: ${FECHA_REFERENCIA.toISOString().slice(0, 10)}\n`,
  );
  stdout.write(
    `Vara: ${casillas.length} casillas (${firmes.length} firmes, ${revisar.length} por revisar) de ${PUESTOS.length} puestos. Solo mide.\n`,
  );

  // A. Matriz de confusión (vara × motor) sobre las firmes.
  stdout.write(`\n${"=".repeat(74)}\nA. Matriz de confusión — filas = vara (correcto), columnas = motor\n${"=".repeat(74)}\n\n`);
  stdout.write(`${pad("vara \\ motor", 16)}${CLASES.map((c) => padIzq(ETIQUETA[c], 14)).join("")}${padIzq("total", 8)}\n`);
  stdout.write(`${"-".repeat(74)}\n`);
  let aciertos = 0;
  for (const g of CLASES) {
    const fila = firmes.filter((c) => c.gold.assessment === g);
    const celdas = CLASES.map((m) => padIzq(String(fila.filter((c) => c.motor === m).length), 14)).join("");
    aciertos += fila.filter((c) => c.motor === g).length;
    stdout.write(`${pad(ETIQUETA[g], 16)}${celdas}${padIzq(String(fila.length), 8)}\n`);
  }
  const exactitud = firmes.length === 0 ? 0 : Math.round((aciertos / firmes.length) * 1000) / 10;
  stdout.write(`\nExactitud global (diagonal): ${aciertos}/${firmes.length} = ${exactitud}%\n`);

  // B. Precisión y recall por clase.
  const metricas = calcularMetricas(firmes);
  stdout.write(`\n${"=".repeat(74)}\nB. Precisión y recall por veredicto\n${"=".repeat(74)}\n\n`);
  stdout.write(`${pad("Veredicto", 16)}${padIzq("TP", 6)}${padIzq("FP", 6)}${padIzq("FN", 6)}${padIzq("Precisión", 12)}${padIzq("Recall", 10)}\n`);
  stdout.write(`${"-".repeat(74)}\n`);
  for (const m of metricas) {
    stdout.write(
      `${pad(ETIQUETA[m.clase], 16)}${padIzq(String(m.tp), 6)}${padIzq(String(m.fp), 6)}${padIzq(String(m.fn), 6)}${padIzq(pct(m.precision), 12)}${padIzq(pct(m.recall), 10)}\n`,
    );
  }

  // C. Sobre-acreditación: motor acredita algo que la vara NO da por pleno.
  const sobre = firmes.filter((c) => c.motor === "acreditado" && c.gold.assessment !== "acreditado");
  stdout.write(`\n${"=".repeat(74)}\nC. SOBRE-ACREDITACIÓN — el motor acreditó de más (${sobre.length} de ${firmes.length} firmes)\n${"=".repeat(74)}\n\n`);
  if (sobre.length === 0) stdout.write(`  (ninguna)\n`);
  for (const c of sobre) {
    stdout.write(`  ! ${pad(c.candidato, 18)} ${pad(c.reqCorto, 20)} vara: ${ETIQUETA[c.gold.assessment]} — ${c.gold.nota}\n`);
  }

  // D. Mérito perdido: la vara acredita algo que el motor descartó o no vio.
  const perdido = firmes.filter(
    (c) => c.gold.assessment === "acreditado" && (c.motor === "no_cumplido" || c.motor === "sin_evidencia"),
  );
  stdout.write(`\n${"=".repeat(74)}\nD. MÉRITO PERDIDO — el motor descartó algo válido (${perdido.length} de ${firmes.length} firmes)\n${"=".repeat(74)}\n\n`);
  if (perdido.length === 0) stdout.write(`  (ninguno)\n`);
  for (const c of perdido) {
    stdout.write(`  ! ${pad(c.candidato, 18)} ${pad(c.reqCorto, 20)} motor: ${ETIQUETA[c.motor]} — vara: ${c.gold.nota}\n`);
  }

  // E. Casillas por revisar: fuera de métricas, con lo que dijo el motor.
  stdout.write(`\n${"=".repeat(74)}\nE. CASILLAS POR REVISAR (${revisar.length}) — tu visto bueno; fuera de las métricas\n${"=".repeat(74)}\n\n`);
  for (const c of revisar) {
    const coincide = c.motor === c.gold.assessment ? "=" : "≠";
    stdout.write(
      `  ? ${pad(c.candidato, 16)} ${pad(c.reqCorto, 18)} vara: ${pad(ETIQUETA[c.gold.assessment], 12)} ${coincide} motor: ${pad(ETIQUETA[c.motor], 12)} — ${c.gold.nota}\n`,
    );
  }

  // Veredicto.
  stdout.write(`\n${"=".repeat(74)}\nRESUMEN\n${"=".repeat(74)}\n\n`);
  stdout.write(`  Exactitud sobre casillas firmes: ${exactitud}%\n`);
  stdout.write(`  Sobre-acreditación (acreditó de más): ${sobre.length}\n`);
  stdout.write(`  Mérito perdido (descartó algo válido): ${perdido.length}\n`);
  stdout.write(`  Por revisar (pendientes de tu visto bueno): ${revisar.length}\n`);
  stdout.write(
    `\nNota: la vara es la verdad esperada derivada del contenido del CV, no de lo que el\nmotor responde. El mérito perdido es el error más grave en RRHH; vigílalo al afinar.\n`,
  );

  return sobre.length === 0 && perdido.length === 0;
}

async function main(): Promise<void> {
  const json = argv.slice(2).includes("--json");

  const casillas: Casilla[] = [];
  for (const puesto of PUESTOS) {
    const evaluar = (texto: string) => evaluarTexto(puesto, texto).porRequisito;
    for (const candidato of puesto.candidatos) {
      const delCandidato = await casillasDeCandidato(
        puesto.titulo,
        puesto.carpeta,
        puesto.requisitos,
        evaluar,
        candidato.archivo,
        candidato.nombre,
      );
      casillas.push(...delCandidato);
    }
  }

  if (json) {
    const firmes = casillas.filter((c) => !c.gold.revisar);
    stdout.write(
      `${JSON.stringify(
        {
          motor: RULE_ENGINE_VERSION,
          scoring: SCORING_VERSION,
          fechaReferencia: FECHA_REFERENCIA.toISOString(),
          totales: { casillas: casillas.length, firmes: firmes.length, revisar: casillas.length - firmes.length },
          metricas: calcularMetricas(firmes),
          sobreAcreditacion: firmes.filter((c) => c.motor === "acreditado" && c.gold.assessment !== "acreditado"),
          meritoPerdido: firmes.filter(
            (c) => c.gold.assessment === "acreditado" && (c.motor === "no_cumplido" || c.motor === "sin_evidencia"),
          ),
          casillas,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  imprimirInforme(casillas);

  // Falla si aparece lo grave: acreditar de más o perder un mérito (hoy, 0 y 0).
  // Sin esto la vara terminaba con éxito aunque el motor empeorara, y la
  // revisión automática de GitHub no podía frenar una regresión.
  const graves = casillas.filter(
    (c) =>
      !c.gold.revisar &&
      ((c.motor === "acreditado" && c.gold.assessment !== "acreditado") ||
        (c.gold.assessment === "acreditado" && (c.motor === "no_cumplido" || c.motor === "sin_evidencia"))),
  );
  if (graves.length > 0) exit(1);
}

main().catch((error: unknown) => {
  stderr.write(`\n[gold-motor] ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
