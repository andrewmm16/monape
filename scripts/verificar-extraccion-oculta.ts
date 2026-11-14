// Verifica que el reensamblado de texto con exclusión de fragmentos ocultos
// (pdf-text.ts) produce, en CVs SIN trampa, un texto IDÉNTICO al del extractor
// actual (unpdf.extractText). Es la red de seguridad de la "Opción B": la
// exclusión solo debe cambiar el resultado cuando de verdad hay texto oculto,
// nunca en un CV honesto. Si algún PDF difiere, imprime el diff y sale con 1.
//
// Uso (desde la raíz):  npx tsx scripts/verificar-extraccion-oculta.ts
// Requiere los PDF del banco:  npx tsx scripts/generar-cv-prueba.ts

import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { exit, stdout } from "node:process";
import { extractText, getDocumentProxy } from "unpdf";
import { extractRawText } from "../src/modules/resumes/extraction-core";

const RAIZ = resolve(import.meta.dirname, "..", "cv-prueba");

async function listarPdfs(dir: string): Promise<string[]> {
  const entradas = await readdir(dir, { withFileTypes: true });
  const pdfs: string[] = [];
  for (const e of entradas) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) pdfs.push(...(await listarPdfs(ruta)));
    else if (e.name.toLowerCase().endsWith(".pdf")) pdfs.push(ruta);
  }
  return pdfs;
}

/** Texto por el extractor actual (unpdf), sin exclusión de ocultos. */
async function viaUnpdf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, stopAtErrors: false });
  try {
    return (await extractText(pdf, { mergePages: true })).text;
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

function primeraDiferencia(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

async function main() {
  const pdfs = (await listarPdfs(RAIZ)).sort();
  if (pdfs.length === 0) {
    stdout.write("No hay PDF en cv-prueba/. Genera el banco: npx tsx scripts/generar-cv-prueba.ts\n");
    exit(1);
  }
  let diferentes = 0;
  for (const ruta of pdfs) {
    const bytes = new Uint8Array(await readFile(ruta));
    const [actual, nuevo] = await Promise.all([viaUnpdf(bytes), extractRawText(bytes, "pdf")]);
    const rel = relative(RAIZ, ruta);
    if (actual === nuevo) {
      stdout.write(`  OK  ${rel}\n`);
    } else {
      diferentes++;
      const i = primeraDiferencia(actual, nuevo);
      stdout.write(`DIFF  ${rel}  (primera diferencia en el caracter ${i})\n`);
      stdout.write(`        actual: ${JSON.stringify(actual.slice(Math.max(0, i - 20), i + 20))}\n`);
      stdout.write(`         nuevo: ${JSON.stringify(nuevo.slice(Math.max(0, i - 20), i + 20))}\n`);
    }
  }
  stdout.write(`\n${pdfs.length - diferentes}/${pdfs.length} PDF idénticos al extractor actual.\n`);
  if (diferentes > 0) {
    stdout.write(`${diferentes} con diferencias: el reensamblado NO es equivalente todavía. Ajustar antes de activar la exclusión.\n`);
    exit(1);
  }
  stdout.write("Equivalencia confirmada: la exclusión no altera los CVs sin texto oculto.\n");
}

void main();
