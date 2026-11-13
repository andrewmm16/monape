// Mide el motor sobre los MISMOS 32 CV en formato .docx, que es la otra ruta
// de extracción que acepta la aplicación (`ResumeFileKind = "pdf" | "docx"`).
//
// Uso:
//   npm run medir:motor:docx
//   npm run medir:motor:docx -- --puesto 6
//   npm run medir:motor:docx -- --texto Quispe
//
// Un .docx no se parece por dentro a un PDF, y por eso hace falta medirlo:
//
//  - Un párrafo es UN texto, se parta donde se parta al imprimirlo. No existe
//    el corte de línea por el ancho de la hoja, que es justo lo que rompía la
//    negación en los PDF.
//  - No hay letras espaciadas por el renderizador ni columnas que reordenar.
//  - En cambio aparece la CABECERA, que vive en otra parte del archivo: en dos
//    de los CV los datos de contacto están ahí, y la extracción los antepone al
//    cuerpo, así que el texto empieza por el correo y no por el nombre.
//  - Y aparecen TABLAS: las habilidades van en una tabla de dos columnas, como
//    en tantas plantillas de Word.
//
// Los .docx se generan con `npx tsx scripts/generar-cv-docx.ts`.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { RULE_ENGINE_VERSION } from "../../src/modules/evaluation/rule-engine";
import { extractRawText } from "../../src/modules/resumes/extraction-core";
import { cambiosDe, imprimirPuesto, imprimirResumen, inversiones, type Cambio, type Comparado } from "./comparacion";
import { evaluarTexto } from "./evaluar";
import { PUESTOS, type CandidatoFixture, type PuestoFixture } from "./datos";

const RAIZ_PDF = resolve(import.meta.dirname, "..", "..", "cv-prueba");
const RAIZ_DOCX = resolve(import.meta.dirname, "..", "..", "cv-prueba-docx");

function rutaDocx(puesto: PuestoFixture, candidato: CandidatoFixture): string {
  return join(RAIZ_DOCX, puesto.carpeta, candidato.archivo.replace(/\.pdf$/, ".docx"));
}

async function leer(ruta: string, comoGenerar: string): Promise<Buffer> {
  try {
    return await readFile(ruta);
  } catch {
    throw new Error(`No se encontró ${ruta}\nGenérelos con: ${comoGenerar}`);
  }
}

async function comparar(puesto: PuestoFixture, candidato: CandidatoFixture): Promise<Comparado> {
  const pdf = await leer(join(RAIZ_PDF, puesto.carpeta, candidato.archivo), "npx tsx scripts/generar-cv-prueba.ts");
  const docx = await leer(rutaDocx(puesto, candidato), "npx tsx scripts/generar-cv-docx.ts");

  const textoPdf = await extractRawText(new Uint8Array(pdf), "pdf");
  const inicio = Date.now();
  const textoDocx = await extractRawText(new Uint8Array(docx), "docx");
  const segundos = (Date.now() - inicio) / 1000;

  return {
    candidato,
    referencia: evaluarTexto(puesto, textoPdf),
    fuente: evaluarTexto(puesto, textoDocx),
    caracteresReferencia: textoPdf.trim().length,
    caracteresFuente: textoDocx.trim().length,
    segundos,
  };
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
        const ruta = rutaDocx(puesto, candidato);
        const texto = await extractRawText(new Uint8Array(await leer(ruta, "npx tsx scripts/generar-cv-docx.ts")), "docx");
        stdout.write(`\n${candidato.nombre} · ${ruta}\n${"-".repeat(98)}\n${texto}\n`);
      }
    }
    return;
  }

  stdout.write(
    `\nBanco de CV en .docx · motor ${RULE_ENGINE_VERSION}\n` +
      `Los mismos CV en Word, por la ruta de extracción de .docx de la aplicación.\n` +
      `La referencia de cada requisito es el PDF con capa de texto.\n`,
  );

  const cambios: Cambio[] = [];
  let ordenRoto = 0;
  for (const puesto of puestos) {
    const comparados: Comparado[] = [];
    for (const candidato of puesto.candidatos) comparados.push(await comparar(puesto, candidato));
    imprimirPuesto(puesto, comparados, "docx");
    for (const c of comparados) cambios.push(...cambiosDe(puesto, c));
    if (inversiones(comparados).length > 0) ordenRoto++;
  }

  exit(imprimirResumen(cambios, puestos.length, ordenRoto, "npm run medir:motor:docx"));
}

main().catch((error: unknown) => {
  stdout.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
