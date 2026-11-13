// Audita los criterios de las 8 vacantes del banco con el auditor de
// requisitos (src/modules/evaluation/requirement-audit.ts).
//
// Uso:
//   npm run auditar:vacantes
//   npm run auditar:vacantes -- --puesto 4
//
// Para qué sirve esto aquí. El auditor avisa de configuraciones que harán que
// el motor dé un resultado equivocado, y la única forma de saber si avisa bien
// es pasarlo por criterios reales: tiene que encontrar el caso del «B2» que el
// banco de CV escaneados ya demostró, y tiene que CALLARSE en los demás. Un
// auditor que avisa de todo no se lee, y uno que no avisa de nada no sirve.

import { argv, exit, stdout } from "node:process";
import { auditRequirements, GRAVEDAD_ETIQUETA, type Gravedad } from "../../src/modules/evaluation/requirement-audit";
import { pad } from "./evaluar";
import { PUESTOS } from "./datos";

const MARCA: Record<Gravedad, string> = { bloquea: "[BLOQUEA]", riesgo: "[RIESGO] ", aviso: "[aviso]  " };

function main(): void {
  const indice = argv.indexOf("--puesto");
  const solo = indice >= 0 ? Number(argv[indice + 1]) : null;
  const puestos = solo === null ? PUESTOS : PUESTOS.filter((p) => p.id === solo);
  if (puestos.length === 0) throw new Error(`No hay puesto con id ${solo}`);

  stdout.write(`\nAuditoría de criterios · ${puestos.length} ${puestos.length === 1 ? "vacante" : "vacantes"}\n`);
  stdout.write(`Cada aviso dice qué hará el motor con esos criterios, no qué estilo preferiría.\n`);

  let requisitos = 0;
  const porGravedad: Record<Gravedad, number> = { bloquea: 0, riesgo: 0, aviso: 0 };

  for (const puesto of puestos) {
    const { hallazgos, pesoEsencial } = auditRequirements(puesto.requisitos);
    requisitos += puesto.requisitos.length;
    stdout.write(`\n${"=".repeat(98)}\n${puesto.id}. ${puesto.titulo}\n`);
    stdout.write(`${puesto.requisitos.length} requisitos · ${pesoEsencial} % del peso es legal o esencial\n${"=".repeat(98)}\n`);

    if (hallazgos.length === 0) {
      stdout.write("\nSin observaciones.\n");
      continue;
    }
    for (const h of hallazgos) {
      porGravedad[h.gravedad]++;
      const requisito = puesto.requisitos.find((r) => r.id === h.requirementId);
      const titulo = requisito ? `«${requisito.corto}»` : "la vacante completa";
      stdout.write(`\n${MARCA[h.gravedad]} ${titulo}\n`);
      stdout.write(`  ${h.problema}\n`);
      stdout.write(`  → ${h.sugerencia}\n`);
    }
  }

  stdout.write(`\n${"=".repeat(98)}\nRESUMEN\n${"=".repeat(98)}\n`);
  stdout.write(`Requisitos auditados: ${requisitos}\n`);
  for (const gravedad of ["bloquea", "riesgo", "aviso"] as const) {
    stdout.write(`  ${pad(`${MARCA[gravedad]} ${GRAVEDAD_ETIQUETA[gravedad]}`, 48)}${porGravedad[gravedad]}\n`);
  }
  // No falla nunca: es una herramienta de revisión, no una prueba. Los criterios
  // los decide RRHH y puede haber razones para dejarlos como están.
  exit(0);
}

try {
  main();
} catch (error: unknown) {
  stdout.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
}
