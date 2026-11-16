import { writeFile } from "node:fs/promises";
import { abrirNavegador, cerrarNavegador } from "./browser";
import { construirUrlBusqueda, extraerOferta, inspeccionar, recolectarEnlaces } from "./scrape";
import type { OfertaPublica, ResultadoScraping } from "./types";

/** Pausa aleatoria entre avisos (cortesía de rate-limit, no evasión). */
function jitter(minMs = 3_000, maxMs = 5_000): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SALIDA = "ofertas_mercado.json";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Modo diagnóstico: `--inspeccionar <url>` vuelca la estructura de un aviso.
  const idxInspeccionar = args.indexOf("--inspeccionar");
  if (idxInspeccionar !== -1) {
    const url = args[idxInspeccionar + 1];
    if (!url) throw new Error("uso: --inspeccionar <url-de-un-aviso>");
    const sesion = await abrirNavegador();
    try {
      await inspeccionar(sesion.page, url);
    } finally {
      await cerrarNavegador(sesion);
    }
    return;
  }

  const palabraClave = args.join(" ").trim();
  if (!palabraClave) throw new Error('uso: tsx src/index.ts "Ingeniero Sanitario"');

  const sesion = await abrirNavegador();
  const ofertas: OfertaPublica[] = [];
  const fallidos: { url: string; error: string }[] = [];

  try {
    const urlBusqueda = construirUrlBusqueda(palabraClave);
    console.log(`Búsqueda: ${urlBusqueda}`);
    await sesion.page.goto(urlBusqueda, { waitUntil: "domcontentloaded" });

    const enlaces = await recolectarEnlaces(sesion.page);
    console.log(`Avisos encontrados en la primera página: ${enlaces.length}`);

    for (const [i, url] of enlaces.entries()) {
      try {
        const oferta = await extraerOferta(sesion.page, url);
        ofertas.push(oferta);
        console.log(`  [${i + 1}/${enlaces.length}] ${oferta.titulo} — ${oferta.empresa || "(empresa no detectada)"}`);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        fallidos.push({ url, error: mensaje });
        console.warn(`  [${i + 1}/${enlaces.length}] falló (${mensaje}); se continúa con el siguiente`);
      }
      // Pausa salvo tras el último, para no esperar de más.
      if (i < enlaces.length - 1) await jitter();
    }
  } finally {
    await cerrarNavegador(sesion);
  }

  const resultado: ResultadoScraping = {
    palabraClave,
    fecha: new Date().toISOString(),
    total: ofertas.length,
    ofertas,
    fallidos,
  };
  await writeFile(SALIDA, JSON.stringify(resultado, null, 2), "utf8");
  console.log(`\nGuardado: ${SALIDA} (${ofertas.length} ofertas, ${fallidos.length} fallidas)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
