// Mide el motor sobre los MISMOS 32 CV leídos con OCR, como si hubieran
// llegado escaneados. Es la ruta real de la aplicación para un PDF sin capa de
// texto: rasterizado de la página con pdf.js y reconocimiento con tesseract.js
// y los datos locales en español (sin red, sin base de datos).
//
// Uso:
//   npm run medir:motor:escaneado
//   npm run medir:motor:escaneado -- --puesto 6
//   npm run medir:motor:escaneado -- --texto Quispe     (ver el OCR de un CV)
//
// Qué se mide y con qué criterio. El OCR pierde caracteres: esperar el mismo
// resultado que con la capa de texto sería absurdo. Lo que NO puede pasar es:
//
//   1. Que el OCR haga acreditar algo que con el texto limpio no se acreditaba
//      (INFLA). Un carácter mal leído no puede inventar evidencia.
//   2. Que se rompa el ORDEN de los candidatos dentro de la vacante. Es lo que
//      el reclutador usa, y es el criterio de producto.
//
// Perder un requisito hacia «pendiente» (CASTIGA) es la degradación aceptable:
// el reclutador ve el requisito marcado para revisar, con su cita. Se lista
// uno por uno igualmente, porque parte es corregible en el motor.
//
// El comando necesita `--conditions=react-server` (está en package.json): los
// módulos de OCR son `server-only` y esa condición resuelve ese paquete al
// módulo vacío, igual que hace Next en el servidor.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { RULE_ENGINE_VERSION } from "../../src/modules/evaluation/rule-engine";
import { extractRawText } from "../../src/modules/resumes/extraction-core";
import { runOcr } from "../../src/modules/resumes/ocr/index";
import { apellidos, CODIGO, evaluarTexto, pad, padIzq, type Valoracion } from "./evaluar";
import { ETIQUETA_AJUSTE, ORDEN_AJUSTE, PUESTOS, type CandidatoFixture, type PuestoFixture } from "./datos";

const RAIZ_CV = resolve(import.meta.dirname, "..", "..", "cv-prueba");
const RAIZ_ESCANEADO = resolve(import.meta.dirname, "..", "..", "cv-prueba-escaneado");

/**
 * De dónde sale el PDF que se lee con OCR. Sin `--desde`, se rasteriza el PDF
 * digital: el OCR lo lee casi perfecto, así que eso mide el techo del OCR, no
 * un escaneo. Con `--desde oficina` o `--desde foto` se usan los escaneos
 * degradados de `scripts/generar-cv-escaneado.ts`, que es la medida realista.
 */
const indiceDesde = argv.indexOf("--desde");
const PERFIL = indiceDesde >= 0 ? argv[indiceDesde + 1] : null;

function rutaDelCv(puesto: PuestoFixture, candidato: CandidatoFixture): string {
  return PERFIL === null
    ? join(RAIZ_CV, puesto.carpeta, candidato.archivo)
    : join(RAIZ_ESCANEADO, PERFIL, puesto.carpeta, candidato.archivo);
}

type Comparado = {
  candidato: CandidatoFixture;
  texto: Valoracion;
  ocr: Valoracion;
  caracteresTexto: number;
  caracteresOcr: number;
  segundos: number;
};

type Cambio = {
  puesto: string;
  candidato: string;
  requisito: string;
  corto: string;
  de: string;
  a: string;
  direccion: "INFLA" | "CASTIGA" | "LATERAL";
  motivoOcr: string;
};

async function leer(ruta: string): Promise<Buffer> {
  try {
    return await readFile(ruta);
  } catch {
    throw new Error(
      `No se encontró ${ruta}\n` +
        (PERFIL === null
          ? "Regenere los PDF con: npx tsx scripts/generar-cv-prueba.ts"
          : `Genere los escaneos con: npx tsx scripts/generar-cv-escaneado.ts ${PERFIL}`),
    );
  }
}

async function comparar(puesto: PuestoFixture, candidato: CandidatoFixture): Promise<Comparado> {
  // La referencia es SIEMPRE el PDF con capa de texto: es el resultado que ya
  // está validado por los otros bancos. Lo que cambia con `--desde` es el
  // archivo que se le da al OCR.
  const textoPlano = await extractRawText(new Uint8Array(await leer(join(RAIZ_CV, puesto.carpeta, candidato.archivo))), "pdf");
  const bytesOcr = new Uint8Array(await leer(rutaDelCv(puesto, candidato)));
  const inicio = Date.now();
  const run = await runOcr(bytesOcr);
  const segundos = (Date.now() - inicio) / 1000;
  if (run.status !== "ok") {
    throw new Error(
      `El OCR no pudo leer ${candidato.archivo}: estado «${run.status}»` +
        (run.status === "fallido" ? ` (${run.reason})` : "") +
        `\nSi es «no_disponible», falta el paquete @tesseract.js-data/spa.`,
    );
  }

  return {
    candidato,
    texto: evaluarTexto(puesto, textoPlano),
    ocr: evaluarTexto(puesto, run.text),
    caracteresTexto: textoPlano.trim().length,
    caracteresOcr: run.text.trim().length,
    segundos,
  };
}

function cambiosDe(puesto: PuestoFixture, c: Comparado): Cambio[] {
  const cambios: Cambio[] = [];
  for (const requisito of puesto.requisitos) {
    const antes = c.texto.porRequisito.get(requisito.id)!;
    const ahora = c.ocr.porRequisito.get(requisito.id)!;
    if (antes.assessment === ahora.assessment) continue;
    const direccion =
      ahora.assessment === "acreditado" ? "INFLA" : antes.assessment === "acreditado" ? "CASTIGA" : "LATERAL";
    cambios.push({
      puesto: puesto.titulo,
      candidato: apellidos(c.candidato.nombre),
      requisito: requisito.description,
      corto: requisito.corto,
      de: antes.assessment,
      a: ahora.assessment,
      direccion,
      motivoOcr: ahora.rationale,
    });
  }
  return cambios;
}

/** Inversiones de orden respecto al ajuste asignado a mano. */
function inversiones(comparados: Comparado[], lado: "texto" | "ocr"): string[] {
  const fallos: string[] = [];
  const ordenados = [...comparados].sort((a, b) => ORDEN_AJUSTE[a.candidato.ajuste] - ORDEN_AJUSTE[b.candidato.ajuste]);
  for (let i = 0; i < ordenados.length; i++) {
    for (let j = i + 1; j < ordenados.length; j++) {
      const mejor = ordenados[i]!;
      const peor = ordenados[j]!;
      if (mejor[lado].score < peor[lado].score) {
        fallos.push(
          `${apellidos(mejor.candidato.nombre)} (${ETIQUETA_AJUSTE[mejor.candidato.ajuste]}, ${mejor[lado].score} %) ` +
            `queda por debajo de ${apellidos(peor.candidato.nombre)} ` +
            `(${ETIQUETA_AJUSTE[peor.candidato.ajuste]}, ${peor[lado].score} %)`,
        );
      }
    }
  }
  return fallos;
}

function imprimirPuesto(puesto: PuestoFixture, comparados: Comparado[]): void {
  const ordenados = [...comparados].sort((a, b) => ORDEN_AJUSTE[a.candidato.ajuste] - ORDEN_AJUSTE[b.candidato.ajuste]);
  stdout.write(`\n${"=".repeat(98)}\n${puesto.id}. ${puesto.titulo}\n${"=".repeat(98)}\n\n`);
  stdout.write(
    `${pad("Candidato", 24)}${pad("Ajuste", 20)}${padIzq("Texto", 8)}${padIzq("OCR", 8)}${padIzq("Δ", 8)}  ` +
      `${pad("Nivel texto", 11)}${pad("Nivel OCR", 11)}${padIzq("car.", 7)}${padIzq("OCR s", 7)}\n`,
  );
  stdout.write(`${"-".repeat(98)}\n`);
  for (const c of ordenados) {
    const deriva = Math.round((c.ocr.score - c.texto.score) * 100) / 100;
    const perdida = Math.round((100 * (c.caracteresOcr - c.caracteresTexto)) / Math.max(c.caracteresTexto, 1));
    stdout.write(
      `${pad(apellidos(c.candidato.nombre), 24)}${pad(ETIQUETA_AJUSTE[c.candidato.ajuste], 20)}` +
        `${padIzq(`${c.texto.score} %`, 8)}${padIzq(`${c.ocr.score} %`, 8)}${padIzq(deriva > 0 ? `+${deriva}` : `${deriva}`, 8)}  ` +
        `${pad(c.texto.nivel, 11)}${pad(c.ocr.nivel, 11)}${padIzq(`${perdida > 0 ? "+" : ""}${perdida} %`, 7)}` +
        `${padIzq(c.segundos.toFixed(1), 7)}\n`,
    );
  }

  stdout.write(`\nValoración por requisito  (texto → OCR; «=» sin cambio)\n\n`);
  const cabecera = ordenados.map((c) => padIzq(apellidos(c.candidato.nombre).split(" ")[0]!.slice(0, 9), 10)).join("");
  stdout.write(`${pad("", 22)}${padIzq("Peso", 6)}${cabecera}\n${"-".repeat(98)}\n`);
  for (const requisito of puesto.requisitos) {
    const celdas = ordenados
      .map((c) => {
        const antes = c.texto.porRequisito.get(requisito.id)!.assessment;
        const ahora = c.ocr.porRequisito.get(requisito.id)!.assessment;
        return padIzq(antes === ahora ? CODIGO[antes] : `${CODIGO[antes]}→${CODIGO[ahora]}`, 10);
      })
      .join("");
    stdout.write(`${pad(requisito.corto, 22)}${padIzq(String(requisito.weight), 6)}${celdas}\n`);
  }

  const fallosOcr = inversiones(comparados, "ocr");
  stdout.write(`\nOrden con OCR: ${fallosOcr.length === 0 ? "CORRECTO" : "INCORRECTO"}\n`);
  for (const fallo of fallosOcr) stdout.write(`  · ${fallo}\n`);
}

async function main(): Promise<void> {
  const indicePuesto = argv.indexOf("--puesto");
  const soloPuesto = indicePuesto >= 0 ? Number(argv[indicePuesto + 1]) : null;
  const indiceTexto = argv.indexOf("--texto");
  const verTexto = indiceTexto >= 0 ? argv[indiceTexto + 1]?.toLowerCase() : undefined;

  const puestos = soloPuesto === null ? PUESTOS : PUESTOS.filter((p) => p.id === soloPuesto);
  if (puestos.length === 0) throw new Error(`No hay puesto con id ${soloPuesto}`);

  if (verTexto !== undefined) {
    for (const puesto of puestos) {
      for (const candidato of puesto.candidatos) {
        if (!candidato.nombre.toLowerCase().includes(verTexto)) continue;
        // Mismo archivo que mide el banco: si esto leyera siempre el original,
        // mostraría un OCR impecable mientras el banco mide otra cosa.
        const ruta = rutaDelCv(puesto, candidato);
        const run = await runOcr(new Uint8Array(await leer(ruta)));
        stdout.write(`\n${candidato.nombre} · ${ruta}\n${"-".repeat(98)}\n`);
        stdout.write(run.status === "ok" ? `${run.text}\n` : `OCR no disponible: ${run.status}\n`);
      }
    }
    return;
  }

  stdout.write(
    `\nBanco de CV ESCANEADOS · motor ${RULE_ENGINE_VERSION}\n` +
      `Ruta real de OCR: pdf.js rasteriza y tesseract.js reconoce en español, en local.\n` +
      (PERFIL === null
        ? `Origen: el PDF digital rasterizado a 300 dpi. Es el TECHO del OCR, no un escaneo:\n` +
          `para la medida realista use --desde oficina o --desde foto.\n`
        : `Origen: escaneos del perfil «${PERFIL}» (cv-prueba-escaneado/${PERFIL}).\n`) +
      `Tarda unos segundos por CV: el OCR va de uno en uno por el semáforo del motor.\n`,
  );

  const cambios: Cambio[] = [];
  let inversionesOcr = 0;
  let puestosMedidos = 0;

  for (const puesto of puestos) {
    const comparados: Comparado[] = [];
    for (const candidato of puesto.candidatos) comparados.push(await comparar(puesto, candidato));
    imprimirPuesto(puesto, comparados);
    for (const c of comparados) cambios.push(...cambiosDe(puesto, c));
    if (inversiones(comparados, "ocr").length > 0) inversionesOcr++;
    puestosMedidos++;
  }

  const infla = cambios.filter((c) => c.direccion === "INFLA");
  const castiga = cambios.filter((c) => c.direccion === "CASTIGA");
  const lateral = cambios.filter((c) => c.direccion === "LATERAL");

  stdout.write(`\n${"=".repeat(98)}\nRESUMEN\n${"=".repeat(98)}\n`);
  stdout.write(`Puestos con el orden correcto usando OCR: ${puestosMedidos - inversionesOcr} de ${puestosMedidos}\n`);
  stdout.write(`Valoraciones que cambian al pasar por OCR: ${cambios.length}\n`);
  stdout.write(`  ${pad("INFLA (inaceptable)", 24)}${infla.length}\n`);
  stdout.write(`  ${pad("CASTIGA (a revisar)", 24)}${castiga.length}\n`);
  stdout.write(`  ${pad("LATERAL", 24)}${lateral.length}\n`);

  for (const [titulo, lista] of [
    ["INFLA · el OCR hizo acreditar algo que el texto limpio no acreditaba", infla],
    ["CASTIGA · el OCR perdió un requisito que el texto limpio acreditaba", castiga],
    ["LATERAL · cambió de motivo sin ganar ni perder la acreditación", lateral],
  ] as const) {
    if (lista.length === 0) continue;
    stdout.write(`\n${titulo}\n${"-".repeat(98)}\n`);
    for (const c of lista) {
      stdout.write(`  ${c.puesto} · ${c.candidato} · «${c.corto}»: ${c.de} → ${c.a}\n`);
      stdout.write(`    motor con OCR: ${c.motivoOcr.slice(0, 160)}\n`);
    }
  }

  stdout.write(`\nPara ver el OCR de un CV concreto: npm run medir:motor:escaneado -- --texto <apellido>\n`);
  // Falla solo por lo inaceptable: una acreditación inventada o un orden roto.
  exit(infla.length > 0 || inversionesOcr > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  stdout.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
