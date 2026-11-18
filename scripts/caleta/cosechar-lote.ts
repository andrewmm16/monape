/**
 * CLI: lectura de CVs en lote para Caleta.
 *
 *   npm run caleta:lote-cv -- [--entrada <carpeta>] [--salida <archivo.json>] [--pausa <ms>]
 *
 * Recorre una carpeta local de CVs (por defecto `cv-prueba/`), extrae de cada
 * PDF/DOCX el nombre, correo, teléfono (y celular de Perú normalizado), LinkedIn
 * y habilidades, y vuelca un JSON estructurado listo para la siguiente etapa del
 * proceso. No descarga ni rastrea nada: la entrada son archivos que ya se tienen.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { leerCvLote, type CandidatoCv } from "../../src/modules/caleta/lector-cv-lote";

type Opciones = { entrada: string; salida: string; pausaMs: number };

function parsearArgs(args: string[]): Opciones {
  const opts: Opciones = {
    entrada: resolve(cwd(), "cv-prueba"),
    salida: resolve(cwd(), "salida", "candidatos_cv.json"),
    pausaMs: 0,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const valor = args[i + 1];
    if (a === "--entrada" && valor) {
      opts.entrada = resolve(cwd(), valor);
      i++;
    } else if (a === "--salida" && valor) {
      opts.salida = resolve(cwd(), valor);
      i++;
    } else if (a === "--pausa" && valor) {
      opts.pausaMs = Math.max(0, Number(valor) || 0);
      i++;
    } else if (a === "--ayuda" || a === "-h") {
      stdout.write(
        "Uso: npm run caleta:lote-cv -- [--entrada <carpeta>] [--salida <archivo.json>] [--pausa <ms>]\n",
      );
      exit(0);
    }
  }
  return opts;
}

/** Agrupa por la primera carpeta de la ruta (el puesto, en `cv-prueba/`). */
function resumenPorGrupo(candidatos: CandidatoCv[]): Map<string, { total: number; aptos: number; celular: number }> {
  const grupos = new Map<string, { total: number; aptos: number; celular: number }>();
  for (const c of candidatos) {
    const grupo = c.archivo.split(/[/\\]/)[0] || "(raíz)";
    const g = grupos.get(grupo) ?? { total: 0, aptos: 0, celular: 0 };
    g.total++;
    if (c.apto) g.aptos++;
    if (c.celularPeru) g.celular++;
    grupos.set(grupo, g);
  }
  return grupos;
}

async function main(): Promise<void> {
  const { entrada, salida, pausaMs } = parsearArgs(argv.slice(2));

  stdout.write(`Leyendo CVs de: ${entrada}\n\n`);

  const resultado = await leerCvLote({
    entrada,
    pausaMs,
    onProgreso: ({ indice, total, candidato, error }) => {
      const n = String(indice + 1).padStart(String(total).length, " ");
      if (error) {
        stdout.write(`  [${n}/${total}] ✗ ${error.archivo} — ${error.error}\n`);
        return;
      }
      const c = candidato!;
      const tel = c.celularPeru ?? c.telefono ?? "—";
      const correo = c.correo ?? "—";
      const marca = c.apto ? "✓" : "·";
      stdout.write(`  [${n}/${total}] ${marca} ${c.nombre ?? c.archivo} | ${correo} | ${tel}\n`);
    },
  });

  await mkdir(dirname(salida), { recursive: true });
  await writeFile(salida, JSON.stringify(resultado, null, 2), "utf8");

  const t = resultado.totales;
  stdout.write(`\nResumen por carpeta:\n`);
  for (const [grupo, g] of resumenPorGrupo(resultado.candidatos)) {
    stdout.write(`  ${grupo.padEnd(32)} ${g.aptos}/${g.total} aptos · ${g.celular} con celular PE\n`);
  }
  stdout.write(
    `\nTotales: ${t.candidatos} CV leídos, ${t.aptos} aptos, ${t.conCelularPeru} con celular de Perú, ${t.errores} con error.\n`,
  );
  stdout.write(`JSON escrito en: ${relative(cwd(), salida)}\n`);
}

main().catch((e) => {
  stderr.write(`Error no recuperable: ${e instanceof Error ? e.message : String(e)}\n`);
  exit(1);
});
