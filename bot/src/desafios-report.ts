import { desafiosFile, readDesafios, resumirDesafios, type ConteoDesafios } from "./captcha/metrica";

/**
 * Informe de la métrica de desafíos de verificación (solo lectura): cuántos y de qué tipo
 * aparecieron por portal y qué tasa resolvió el robot. Sirve para decidir con datos qué
 * solvers reales construir. Lee `BOT_DESAFIOS_FILE` (por defecto `bot/.state/desafios.json`).
 */
const pct = (c: ConteoDesafios): string => (c.total === 0 ? "—" : `${Math.round((c.resueltos / c.total) * 100)}%`);

function main(): void {
  const eventos = readDesafios();
  const r = resumirDesafios(eventos);
  console.log(`Archivo: ${desafiosFile()}`);
  console.log(`Desafíos registrados: ${r.total} (resueltos ${r.resueltos}, ${pct(r)})`);
  if (r.total === 0) {
    console.log("Aún no hay eventos. Se registran cada vez que un portal pide una verificación.");
    return;
  }
  const bloque = (titulo: string, mapa: Record<string, ConteoDesafios>) => {
    console.log(`\n${titulo}:`);
    for (const [clave, c] of Object.entries(mapa).sort((a, b) => b[1].total - a[1].total)) {
      console.log(`  ${clave}: ${c.total} (resueltos ${c.resueltos}, ${pct(c)})`);
    }
  };
  bloque("Por portal", r.porPortal);
  bloque("Por tipo", r.porTipo);
}

main();
