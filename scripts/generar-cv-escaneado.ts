/**
 * Genera versiones ESCANEADAS (solo imagen, sin capa de texto) de los CV
 * ficticios de cv-prueba/, para medir el motor por la ruta de OCR.
 *
 * Uso (desde la raíz):
 *   npx tsx scripts/generar-cv-escaneado.ts            # los dos perfiles
 *   npx tsx scripts/generar-cv-escaneado.ts oficina
 *   npx tsx scripts/generar-cv-escaneado.ts foto
 *
 * Por qué hace falta degradar. Si solo se rasteriza el PDF digital a 300 dpi,
 * el OCR lo lee casi perfecto y la medición sale inmaculada sin haber medido
 * nada: un escaneo real llega con menos resolución, torcido, con ruido del
 * sensor y comprimido en JPEG. Aquí se reproducen esas cuatro cosas.
 *
 *  - `oficina`: 150 dpi, casi derecho, poco ruido, JPEG 70. Un escáner
 *    multifunción corriente.
 *  - `foto`: 100 dpi equivalentes, torcido, con desenfoque, ruido alto y JPEG
 *    45. Una foto del CV impreso tomada con el móvil, que es como llega una
 *    parte de las postulaciones.
 *
 * El ruido y la inclinación son DETERMINISTAS (derivados del nombre del
 * archivo): el banco tiene que dar el mismo resultado en cada ejecución, igual
 * que los otros tres.
 */
import { chromium } from "@playwright/test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { argv, stdout } from "node:process";
import { renderPdfPages } from "../src/modules/resumes/ocr-render-core";

type Perfil = {
  nombre: string;
  /** Resolución final en puntos por pulgada (el rasterizado viene a 300). */
  dpi: number;
  /** Inclinación máxima en grados, hacia un lado u otro. */
  gradosMax: number;
  /** Amplitud del ruido por canal (0-255). */
  ruido: number;
  /** Calidad JPEG, de 0 a 1. */
  jpeg: number;
  /** Desenfoque: se reduce y se amplía la imagen por este factor. */
  desenfoque: number;
};

const PERFILES: Perfil[] = [
  { nombre: "oficina", dpi: 150, gradosMax: 0.4, ruido: 6, jpeg: 0.7, desenfoque: 1 },
  { nombre: "foto", dpi: 100, gradosMax: 1.3, ruido: 16, jpeg: 0.45, desenfoque: 0.82 },
];

const RASTER_DPI = 300;

/** PRNG sembrado (mulberry32): mismo nombre de archivo, mismo ruido siempre. */
function semilla(texto: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convierte una página rasterizada en una imagen con pinta de escaneo.
 *
 * Se usa `loadImage` y NO `new Image(); src = buffer`: lo segundo no decodifica
 * a tiempo, `drawImage` pinta una hoja en blanco y nada avisa del problema. El
 * resultado era una medición que parecía demoledora —el OCR «perdía» 103
 * requisitos— cuando en realidad Tesseract estaba leyendo papel vacío con
 * ruido. Si alguien vuelve a tocar esto, el control es la variante limpia: si
 * un escaneo a 300 dpi sin ruido no da texto, el fallo está aquí.
 */
async function degradar(png: Uint8Array, perfil: Perfil, azar: () => number): Promise<Buffer> {
  const original = await loadImage(Buffer.from(png));

  const factor = perfil.dpi / RASTER_DPI;
  const ancho = Math.max(1, Math.round(original.width * factor));
  const alto = Math.max(1, Math.round(original.height * factor));

  // 1. Reducción de resolución, sobre fondo blanco (el papel).
  const lienzo = createCanvas(ancho, alto);
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ancho, alto);

  // 2. Inclinación: el papel nunca entra recto en el cristal.
  const grados = (azar() * 2 - 1) * perfil.gradosMax;
  ctx.save();
  ctx.translate(ancho / 2, alto / 2);
  ctx.rotate((grados * Math.PI) / 180);
  ctx.drawImage(original, -ancho / 2, -alto / 2, ancho, alto);
  ctx.restore();

  // 3. Desenfoque por remuestreo: se reduce y se vuelve a ampliar.
  if (perfil.desenfoque < 1) {
    const anchoChico = Math.max(1, Math.round(ancho * perfil.desenfoque));
    const altoChico = Math.max(1, Math.round(alto * perfil.desenfoque));
    const chico = createCanvas(anchoChico, altoChico);
    chico.getContext("2d").drawImage(lienzo, 0, 0, anchoChico, altoChico);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(chico, 0, 0, ancho, alto);
  }

  // 4. Ruido del sensor y un gris de fondo: el blanco del papel nunca es 255.
  const datos = ctx.getImageData(0, 0, ancho, alto);
  const pixeles = datos.data;
  for (let i = 0; i < pixeles.length; i += 4) {
    const delta = Math.round((azar() * 2 - 1) * perfil.ruido);
    for (let canal = 0; canal < 3; canal++) {
      const valor = pixeles[i + canal]! - 4 + delta;
      pixeles[i + canal] = valor < 0 ? 0 : valor > 255 ? 255 : valor;
    }
  }
  ctx.putImageData(datos, 0, 0);

  return lienzo.toBuffer("image/jpeg", Math.round(perfil.jpeg * 100));
}

const HOJA = (imagenes: string[]) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>CV escaneado</title><style>
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; }
img { display: block; width: 210mm; height: 297mm; page-break-after: always; }
img:last-child { page-break-after: auto; }
</style></head><body>${imagenes.map((src) => `<img src="${src}">`).join("")}</body></html>`;

function carpetasDeCv(raiz: string): string[] {
  return readdirSync(raiz)
    .filter((nombre) => statSync(path.join(raiz, nombre)).isDirectory())
    .sort();
}

async function main(): Promise<void> {
  const pedidos = argv.slice(2).filter((a) => !a.startsWith("--"));
  const perfiles = pedidos.length === 0 ? PERFILES : PERFILES.filter((p) => pedidos.includes(p.nombre));
  if (perfiles.length === 0) {
    throw new Error(`Perfiles disponibles: ${PERFILES.map((p) => p.nombre).join(", ")}`);
  }

  const raizCv = path.resolve(import.meta.dirname, "..", "cv-prueba");
  const raizSalida = path.resolve(import.meta.dirname, "..", "cv-prueba-escaneado");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let total = 0;

  try {
    for (const perfil of perfiles) {
      stdout.write(`\nPerfil «${perfil.nombre}»: ${perfil.dpi} dpi, ±${perfil.gradosMax}°, ruido ${perfil.ruido}, JPEG ${Math.round(perfil.jpeg * 100)}\n`);
      for (const carpeta of carpetasDeCv(raizCv)) {
        const destino = path.join(raizSalida, perfil.nombre, carpeta);
        mkdirSync(destino, { recursive: true });
        for (const archivo of readdirSync(path.join(raizCv, carpeta)).filter((f) => f.endsWith(".pdf")).sort()) {
          const bytes = new Uint8Array(await readFile(path.join(raizCv, carpeta, archivo)));
          const { pages } = await renderPdfPages(bytes);
          const azar = semilla(`${perfil.nombre}/${carpeta}/${archivo}`);
          const imagenes: string[] = [];
          for (const png of pages) {
            const jpeg = await degradar(png, perfil, azar);
            imagenes.push(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
          }
          await page.setContent(HOJA(imagenes), { waitUntil: "load" });
          const salida = path.join(destino, archivo);
          const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
          await writeFile(salida, pdf);
          total++;
          stdout.write(`  OK ${path.join(perfil.nombre, carpeta, archivo)}  (${pages.length} pág.)\n`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  stdout.write(`\nGenerados ${total} CV escaneados en ${raizSalida}\n`);
  stdout.write(`Mídalos con: npm run medir:motor:escaneado -- --desde <perfil>\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
