// Mide el motor de reglas contra el banco de 20 CVs ficticios de cv-prueba/.
//
// Extrae el texto real de los PDF con el mismo pipeline de la app
// (resumes/extraction-core.ts) y corre el motor vigente sobre los criterios de
// cada puesto. No toca la base de datos, no llama a ningún servicio externo y
// no necesita AI_API_KEY: es determinista y repetible.
//
// Uso:
//   npm run medir:motor
//   npm run medir:motor -- --puesto 3
//   npm run medir:motor -- --detalle Ortiz
//   npm run medir:motor -- --json > medicion.json
//
// Nota: extraction-core normalmente corre dentro de un worker porque un archivo
// hostil podría agotar CPU o memoria. Aquí se llama directo porque los 20 PDF
// son los que genera scripts/generar-cv-prueba.ts, no entrada de terceros.

import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { RULE_ENGINE_VERSION } from "../../src/modules/evaluation/rule-engine";
import { SCORING_VERSION } from "../../src/modules/evaluation/scoring";
import { extractRawText } from "../../src/modules/resumes/extraction-core";
import type { CompatibilityLevel, ItemAssessment } from "../../src/modules/evaluation/types";
import { CODIGO, evaluarTexto, pad, padIzq } from "./evaluar";
import {
  ETIQUETA_AJUSTE,
  FECHA_REFERENCIA,
  ORDEN_AJUSTE,
  PUESTOS,
  type CandidatoFixture,
  type PuestoFixture,
} from "./datos";

const RAIZ_CV = resolve(import.meta.dirname, "..", "..", "cv-prueba");

type ResultadoCandidato = {
  candidato: CandidatoFixture;
  caracteres: number;
  score: number;
  nivel: CompatibilityLevel;
  items: ItemAssessment[];
  porRequisito: Map<string, ItemAssessment>;
};

type Hallazgo = {
  gravedad: "alta" | "media";
  puesto: string;
  candidato: string;
  detalle: string;
};

async function evaluarCandidato(
  puesto: PuestoFixture,
  candidato: CandidatoFixture,
): Promise<ResultadoCandidato> {
  const ruta = join(RAIZ_CV, puesto.carpeta, candidato.archivo);
  let bytes: Buffer;
  try {
    bytes = await readFile(ruta);
  } catch {
    throw new Error(
      `No se encontró ${ruta}\nRegenere los PDF con: npx tsx scripts/generar-cv-prueba.ts`,
    );
  }

  const texto = await extractRawText(new Uint8Array(bytes), "pdf");
  // El cálculo vive en evaluar.ts, compartido con el banco de escaneados: si
  // cada script lo hiciera a su manera, comparar los dos no mediría el OCR.
  return { candidato, caracteres: texto.trim().length, ...evaluarTexto(puesto, texto) };
}

/** Pares mal ordenados respecto al ajuste asignado a mano, y empates. */
function revisarOrden(resultados: ResultadoCandidato[]): { inversiones: string[]; empates: string[] } {
  const inversiones: string[] = [];
  const empates: string[] = [];
  const ordenados = [...resultados].sort(
    (a, b) => ORDEN_AJUSTE[a.candidato.ajuste] - ORDEN_AJUSTE[b.candidato.ajuste],
  );

  for (let i = 0; i < ordenados.length; i++) {
    for (let j = i + 1; j < ordenados.length; j++) {
      const mejor = ordenados[i];
      const peor = ordenados[j];
      const apellidoMejor = mejor.candidato.nombre.split(" ").slice(-2).join(" ");
      const apellidoPeor = peor.candidato.nombre.split(" ").slice(-2).join(" ");
      if (mejor.score < peor.score) {
        inversiones.push(
          `${apellidoMejor} (${ETIQUETA_AJUSTE[mejor.candidato.ajuste]}, ${mejor.score} %) queda por debajo de ` +
            `${apellidoPeor} (${ETIQUETA_AJUSTE[peor.candidato.ajuste]}, ${peor.score} %)`,
        );
      } else if (mejor.score === peor.score) {
        empates.push(
          `${apellidoMejor} (${ETIQUETA_AJUSTE[mejor.candidato.ajuste]}) y ` +
            `${apellidoPeor} (${ETIQUETA_AJUSTE[peor.candidato.ajuste]}) empatan en ${mejor.score} %`,
        );
      }
    }
  }
  return { inversiones, empates };
}

function detectarHallazgos(puesto: PuestoFixture, resultados: ResultadoCandidato[]): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const obligatorios = puesto.requisitos.filter((r) => r.priority === "obligatorio");

  for (const resultado of resultados) {
    const { candidato } = resultado;
    const nombre = candidato.nombre.split(" ").slice(-2).join(" ");

    if (resultado.caracteres < 200) {
      hallazgos.push({
        gravedad: "alta",
        puesto: puesto.titulo,
        candidato: nombre,
        detalle: `La extracción del PDF devolvió solo ${resultado.caracteres} caracteres: revise el pipeline de extracción antes de culpar al motor.`,
      });
    }

    // Un CV diseñado como «muy fuerte» debería acreditar todos los
    // obligatorios. Se excluyen los esenciales y las competencias, que el motor
    // deja pendientes a propósito y nunca acredita.
    if (candidato.ajuste === "muy_fuerte") {
      const acreditables = obligatorios.filter((r) => !r.isEssential && r.category !== "competencia");
      for (const requisito of acreditables) {
        const item = resultado.porRequisito.get(requisito.id);
        if (!item) continue;
        if (item.assessment === "sin_evidencia") {
          hallazgos.push({
            gravedad: "alta",
            puesto: puesto.titulo,
            candidato: nombre,
            detalle: `Obligatorio «${requisito.description}» salió SIN EVIDENCIA en el candidato más fuerte. Posible falso negativo (términos mal configurados o límite del motor).`,
          });
        } else if (item.assessment === "pendiente_verificacion") {
          hallazgos.push({
            gravedad: "alta",
            puesto: puesto.titulo,
            candidato: nombre,
            detalle:
              `Obligatorio «${requisito.description}» quedó PENDIENTE en el candidato más fuerte, ` +
              `pese a no ser esencial ni una competencia. El motor encontró algo pero no lo aceptó.\n    ` +
              `Motivo del motor: ${item.rationale}`,
          });
        }
      }
    }

    // Lo contrario: el CV que no encaja no debería acreditar obligatorios.
    if (candidato.ajuste === "no_cumple") {
      for (const requisito of obligatorios) {
        const item = resultado.porRequisito.get(requisito.id);
        if (item && item.assessment === "acreditado") {
          hallazgos.push({
            gravedad: "alta",
            puesto: puesto.titulo,
            candidato: nombre,
            detalle: `Obligatorio «${requisito.description}» salió ACREDITADO en un CV de otro rubro. Posible falso positivo.`,
          });
        }
      }
    }

    // Los puestos añadidos después no tienen expectativa de LEEME.md: su
    // referencia es el orden entre candidatos, no una cifra.
    if (candidato.esperado === null) continue;
    const deriva = Math.round((resultado.score - candidato.esperado.score) * 100) / 100;
    if (Math.abs(deriva) >= 5) {
      hallazgos.push({
        gravedad: "media",
        puesto: puesto.titulo,
        candidato: nombre,
        detalle: `Puntaje ${resultado.score} % frente al ${candidato.esperado.score} % que preveía LEEME.md (${deriva > 0 ? "+" : ""}${deriva}). Recuerde que esa cifra se calculó con reglas-v2.`,
      });
    }
    if (resultado.nivel !== candidato.esperado.nivel) {
      hallazgos.push({
        gravedad: "media",
        puesto: puesto.titulo,
        candidato: nombre,
        detalle: `Nivel «${resultado.nivel}» frente a «${candidato.esperado.nivel}» previsto en LEEME.md (calculado con reglas-v2).`,
      });
    }
  }
  return hallazgos;
}

function imprimirPuesto(puesto: PuestoFixture, resultados: ResultadoCandidato[]): void {
  const ordenados = [...resultados].sort(
    (a, b) => ORDEN_AJUSTE[a.candidato.ajuste] - ORDEN_AJUSTE[b.candidato.ajuste],
  );

  stdout.write(`\n${"=".repeat(96)}\n${puesto.id}. ${puesto.titulo}\n${"=".repeat(96)}\n\n`);

  stdout.write(
    `${pad("Candidato", 26)}${pad("Ajuste previsto", 22)}${padIzq("LEEME", 7)}${padIzq("Real", 8)}${padIzq("Δ", 8)}  ${pad("Nivel real", 11)}${pad("Nivel LEEME", 11)}\n`,
  );
  stdout.write(`${"-".repeat(96)}\n`);
  for (const r of ordenados) {
    const nombre = r.candidato.nombre.split(" ").slice(-2).join(" ");
    const esperado = r.candidato.esperado;
    const deriva = esperado === null ? null : Math.round((r.score - esperado.score) * 100) / 100;
    const signo = deriva === null ? "—" : deriva > 0 ? `+${deriva}` : `${deriva}`;
    stdout.write(
      `${pad(nombre, 26)}${pad(ETIQUETA_AJUSTE[r.candidato.ajuste], 22)}` +
        `${padIzq(esperado === null ? "—" : `${esperado.score} %`, 7)}${padIzq(`${r.score} %`, 8)}${padIzq(signo, 8)}  ` +
        `${pad(r.nivel, 11)}${pad(esperado === null ? "—" : esperado.nivel, 11)}\n`,
    );
  }

  // Matriz requisito × candidato: la vista más útil para ver dónde falla.
  stdout.write(`\nValoración por requisito  (A acreditado · N no cumplido · - sin evidencia · P pendiente)\n\n`);
  const cabecera = ordenados.map((r) => padIzq(r.candidato.nombre.split(" ").slice(-2)[0].slice(0, 9), 10)).join("");
  stdout.write(`${pad("", 22)}${pad("Prio", 6)}${padIzq("Peso", 6)}${cabecera}\n`);
  stdout.write(`${"-".repeat(96)}\n`);
  for (const requisito of puesto.requisitos) {
    const celdas = ordenados
      .map((r) => padIzq(CODIGO[r.porRequisito.get(requisito.id)?.assessment ?? "sin_evidencia"], 10))
      .join("");
    const prio = requisito.priority === "obligatorio" ? "OBL" : "des";
    stdout.write(
      `${pad(requisito.corto, 22)}${pad(prio, 6)}${padIzq(String(requisito.weight), 6)}${celdas}\n`,
    );
  }

  const { inversiones, empates } = revisarOrden(resultados);
  stdout.write(`\nOrden frente al ajuste asignado a mano: `);
  if (inversiones.length === 0) {
    stdout.write(`CORRECTO${empates.length > 0 ? ` (con ${empates.length} empate(s))` : ""}\n`);
  } else {
    stdout.write(`${inversiones.length} par(es) mal ordenado(s)\n`);
    for (const inversion of inversiones) stdout.write(`  ! ${inversion}\n`);
  }
  for (const empate of empates) stdout.write(`  ~ ${empate}\n`);
}

function imprimirDetalle(puesto: PuestoFixture, resultado: ResultadoCandidato): void {
  stdout.write(`\n${"=".repeat(96)}\nDetalle: ${resultado.candidato.nombre} — ${puesto.titulo}\n`);
  stdout.write(`Texto extraído: ${resultado.caracteres} caracteres · Puntaje ${resultado.score} % · Nivel ${resultado.nivel}\n`);
  stdout.write(`${"=".repeat(96)}\n`);
  for (const requisito of puesto.requisitos) {
    const item = resultado.porRequisito.get(requisito.id);
    if (!item) continue;
    stdout.write(
      `\n[${CODIGO[item.assessment]}] ${requisito.description}\n` +
        `    prioridad: ${requisito.priority} · peso: ${requisito.weight}` +
        `${requisito.minYears !== null ? ` · años mín.: ${requisito.minYears}` : ""}` +
        `${requisito.isEssential ? " · ESENCIAL" : ""}\n` +
        `    términos: ${requisito.keywords.join(", ")}\n` +
        `    motivo: ${item.rationale}\n`,
    );
    for (const evidencia of item.evidence) {
      stdout.write(`    > «${evidencia.quote.replace(/\s+/g, " ").trim()}»\n`);
    }
  }
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const idxPuesto = args.indexOf("--puesto");
  const idxDetalle = args.indexOf("--detalle");
  const filtroPuesto = idxPuesto >= 0 ? Number(args[idxPuesto + 1]) : null;
  const filtroDetalle = idxDetalle >= 0 ? args[idxDetalle + 1]?.toLowerCase() : null;

  if (filtroPuesto !== null && !PUESTOS.some((p) => p.id === filtroPuesto)) {
    throw new Error(`--puesto debe ser uno de: ${PUESTOS.map((p) => p.id).join(", ")}`);
  }

  const puestos = filtroPuesto === null ? PUESTOS : PUESTOS.filter((p) => p.id === filtroPuesto);
  const todos: { puesto: PuestoFixture; resultados: ResultadoCandidato[] }[] = [];
  const hallazgos: Hallazgo[] = [];

  for (const puesto of puestos) {
    const resultados: ResultadoCandidato[] = [];
    for (const candidato of puesto.candidatos) {
      resultados.push(await evaluarCandidato(puesto, candidato));
    }
    todos.push({ puesto, resultados });
    hallazgos.push(...detectarHallazgos(puesto, resultados));
  }

  if (json) {
    stdout.write(
      `${JSON.stringify(
        {
          motor: RULE_ENGINE_VERSION,
          scoring: SCORING_VERSION,
          fechaReferencia: FECHA_REFERENCIA.toISOString(),
          puestos: todos.map(({ puesto, resultados }) => ({
            id: puesto.id,
            titulo: puesto.titulo,
            orden: revisarOrden(resultados),
            candidatos: resultados.map((r) => ({
              nombre: r.candidato.nombre,
              ajuste: r.candidato.ajuste,
              caracteres: r.caracteres,
              esperado: r.candidato.esperado,
              real: { score: r.score, nivel: r.nivel },
              items: r.items.map((i) => ({
                requisito: i.requirementId,
                valoracion: i.assessment,
                motivo: i.rationale,
                evidencia: i.evidence.map((e) => e.quote),
              })),
            })),
          })),
          hallazgos,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  stdout.write(
    `Motor: ${RULE_ENGINE_VERSION} · scoring: ${SCORING_VERSION} · fecha de referencia: ${FECHA_REFERENCIA.toISOString().slice(0, 10)}\n`,
  );
  stdout.write(
    `Las columnas «LEEME» son las expectativas de cv-prueba/LEEME.md, calculadas con reglas-v2.\n` +
      `Una diferencia no es necesariamente un defecto; el orden y los hallazgos sí lo indican.\n`,
  );

  if (filtroDetalle) {
    let encontrado = false;
    for (const { puesto, resultados } of todos) {
      for (const resultado of resultados) {
        if (resultado.candidato.nombre.toLowerCase().includes(filtroDetalle)) {
          imprimirDetalle(puesto, resultado);
          encontrado = true;
        }
      }
    }
    if (!encontrado) throw new Error(`Ningún candidato coincide con «${filtroDetalle}»`);
    return;
  }

  for (const { puesto, resultados } of todos) imprimirPuesto(puesto, resultados);

  stdout.write(`\n${"=".repeat(96)}\nRESUMEN\n${"=".repeat(96)}\n\n`);
  const ordenCorrecto = todos.filter(({ resultados }) => revisarOrden(resultados).inversiones.length === 0).length;
  stdout.write(`Puestos con el orden correcto: ${ordenCorrecto} de ${todos.length}\n`);

  const altas = hallazgos.filter((h) => h.gravedad === "alta");
  const medias = hallazgos.filter((h) => h.gravedad === "media");

  if (altas.length > 0) {
    stdout.write(`\nHallazgos que conviene revisar (${altas.length}):\n\n`);
    for (const h of altas) stdout.write(`  [${h.puesto}] ${h.candidato}\n    ${h.detalle}\n\n`);
  } else {
    stdout.write(`\nSin hallazgos de gravedad alta: el motor no tiene falsos negativos ni falsos\npositivos evidentes en los obligatorios de este banco.\n`);
  }

  if (medias.length > 0) {
    stdout.write(`Diferencias frente a las expectativas de LEEME.md (${medias.length}), esperables al pasar de v2 a v3:\n\n`);
    for (const h of medias) stdout.write(`  [${h.puesto}] ${h.candidato}\n    ${h.detalle}\n\n`);
  }

  stdout.write(
    `Para inspeccionar un caso concreto con sus citas:\n  npm run medir:motor -- --detalle <apellido>\n`,
  );

  // Devuelve error si lo que importa salió mal. Sin esto el banco imprimía
  // «orden INCORRECTO» y terminaba con éxito, así que no podía frenar nada: una
  // medición que no puede fallar es decoración, no una prueba.
  if (ordenCorrecto < todos.length || altas.length > 0) exit(1);
}

main().catch((error: unknown) => {
  stderr.write(`\n[medir-motor] ${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
