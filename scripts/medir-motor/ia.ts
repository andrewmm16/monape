// Compara el motor de reglas con la evaluación con IA (cola + worker) sobre el banco de CV
// ficticios de cv-prueba/, y mide el rendimiento real del worker: segundos y tokens por CV.
//
// La IA se llama EXACTAMENTE como en producción: mismo prompt (ai/input.ts), mismo
// transporte (ia-worker/src/cli.ts → `claude -p` con la suscripción) y la misma
// validación (interpretAiResponse: citas literales, requisitos legales nunca acreditados).
// No toca la base de datos. Consume del plan de Claude: imprime lo previsto y espera 5 s.
//
// Uso:
//   npm run medir:ia                                   (todos los puestos, claude-opus-5-5)
//   npm run medir:ia -- --puesto 2 --modelo claude-sonnet-5-5 --concurrencia 3
//   npm run medir:ia -- --max 4 --salida informe.md
//
// La verdad de contraste es el ORDEN de los candidatos de cada puesto (`ajuste` en
// datos.ts): un candidato más fuerte no debería puntuar menos que uno más débil.

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { assembleEvaluation } from "../../src/modules/evaluation/assemble";
import { AI_OUTPUT_JSON_SCHEMA, buildAiInput } from "../../src/modules/evaluation/ai/input";
import { PROMPT_VERSION } from "../../src/modules/evaluation/ai/prompt";
import { interpretAiResponse, InvalidAiResponseError } from "../../src/modules/evaluation/ai/response";
import type { CompatibilityLevel, ItemAssessment } from "../../src/modules/evaluation/types";
import { extractRawText } from "../../src/modules/resumes/extraction-core";
import { runClaude } from "../../ia-worker/src/cli";
import { CODIGO, evaluarTexto, apellidos, pad, padIzq } from "./evaluar";
import { ETIQUETA_AJUSTE, ORDEN_AJUSTE, PUESTOS, type CandidatoFixture, type PuestoFixture } from "./datos";

const RAIZ_CV = resolve(import.meta.dirname, "..", "..", "cv-prueba");

function opcion(nombre: string): string | undefined {
  const i = argv.indexOf(`--${nombre}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const MODELO = opcion("modelo") ?? "claude-opus-5-5";
const CONCURRENCIA = Math.min(4, Math.max(1, Number(opcion("concurrencia") ?? 2)));
const PUESTO = opcion("puesto") ? Number(opcion("puesto")) : undefined;
const MAX = opcion("max") ? Number(opcion("max")) : undefined;
const SALIDA = opcion("salida");
const CLI = process.env.IA_WORKER_CLI_PATH || "claude";
const TIMEOUT_MS = 480_000;

type Caso = { puesto: PuestoFixture; candidato: CandidatoFixture };

type ResultadoIa =
  | { ok: true; score: number; nivel: CompatibilityLevel; porRequisito: Map<string, ItemAssessment>; segundos: number; entrada: number; salida: number; modelo: string }
  | { ok: false; motivo: string; segundos: number };

type Fila = Caso & {
  motor: { score: number; nivel: CompatibilityLevel; porRequisito: Map<string, ItemAssessment> };
  ia: ResultadoIa;
};

async function textoDe(caso: Caso): Promise<string> {
  const bytes = await readFile(join(RAIZ_CV, caso.puesto.carpeta, caso.candidato.archivo));
  return extractRawText(new Uint8Array(bytes), "pdf");
}

async function evaluarConIa(puesto: PuestoFixture, texto: string): Promise<ResultadoIa> {
  const input = buildAiInput({ vacancyTitle: puesto.titulo, requirements: puesto.requisitos, fullText: texto, maxChars: 30_000 });
  const inicio = Date.now();
  const outcome = await runClaude(
    {
      model: MODELO,
      effort: "medium",
      system: input.system,
      prompt: input.userMessage,
      schema: AI_OUTPUT_JSON_SCHEMA,
      id: "00000000-0000-4000-8000-000000000000",
      claimToken: "00000000-0000-4000-8000-000000000000",
      attempt: 1,
    },
    { cliPath: CLI, timeoutMs: TIMEOUT_MS },
  );
  const segundos = (Date.now() - inicio) / 1000;
  if (outcome.kind !== "ok") return { ok: false, motivo: `${outcome.kind}:${outcome.code} ${outcome.detail}`, segundos };
  try {
    const items = interpretAiResponse(outcome.output, puesto.requisitos, input.evaluatedText);
    const result = assembleEvaluation({
      method: "ia",
      methodVersion: PROMPT_VERSION,
      model: outcome.model ?? MODELO,
      requirements: puesto.requisitos,
      items,
      textWasCorrected: false,
      textTruncated: input.textTruncated,
    });
    return {
      ok: true,
      score: result.scores.score,
      nivel: result.level,
      porRequisito: new Map(result.items.map((item) => [item.requirementId, item])),
      segundos,
      entrada: outcome.usage.inputTokens,
      salida: outcome.usage.outputTokens,
      modelo: outcome.model ?? MODELO,
    };
  } catch (error) {
    if (error instanceof InvalidAiResponseError) return { ok: false, motivo: "respuesta_invalida", segundos };
    throw error;
  }
}

/** Ejecuta las tareas con un máximo de `limite` en paralelo, conservando el orden. */
async function enParalelo<T, R>(items: T[], limite: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, items.length) }, async () => {
      while (siguiente < items.length) {
        const i = siguiente++;
        salida[i] = await fn(items[i]!, i);
      }
    }),
  );
  return salida;
}

function inversiones(filas: Fila[], score: (f: Fila) => number | null): string[] {
  const ordenadas = [...filas].sort((a, b) => ORDEN_AJUSTE[a.candidato.ajuste] - ORDEN_AJUSTE[b.candidato.ajuste]);
  const lista: string[] = [];
  for (let i = 0; i < ordenadas.length; i++) {
    for (let j = i + 1; j < ordenadas.length; j++) {
      const mejor = ordenadas[i]!;
      const peor = ordenadas[j]!;
      if (ORDEN_AJUSTE[mejor.candidato.ajuste] === ORDEN_AJUSTE[peor.candidato.ajuste]) continue;
      const a = score(mejor);
      const b = score(peor);
      if (a !== null && b !== null && a < b) {
        lista.push(
          `${apellidos(mejor.candidato.nombre)} (${ETIQUETA_AJUSTE[mejor.candidato.ajuste]}, ${a} %) < ` +
            `${apellidos(peor.candidato.nombre)} (${ETIQUETA_AJUSTE[peor.candidato.ajuste]}, ${b} %)`,
        );
      }
    }
  }
  return lista;
}

async function main(): Promise<void> {
  let casos: Caso[] = PUESTOS.filter((p) => PUESTO === undefined || p.id === PUESTO).flatMap((puesto) =>
    puesto.candidatos.map((candidato) => ({ puesto, candidato })),
  );
  if (MAX !== undefined) casos = casos.slice(0, MAX);
  if (casos.length === 0) {
    console.error("No hay CV que medir con esos filtros.");
    exit(1);
  }

  console.log(`Se evaluarán ${casos.length} CV ficticios con ${MODELO} (${CONCURRENCIA} en paralelo), con la suscripción de Claude.`);
  console.log("Ctrl+C en los próximos 5 s para cancelar…");
  await new Promise((r) => setTimeout(r, 5_000));

  const inicio = Date.now();
  let hechos = 0;
  const filas = await enParalelo(casos, CONCURRENCIA, async (caso): Promise<Fila> => {
    const texto = await textoDe(caso);
    const motor = evaluarTexto(caso.puesto, texto);
    const ia = await evaluarConIa(caso.puesto, texto);
    hechos++;
    stdout.write(`\r  ${hechos}/${casos.length} evaluados…`);
    return { ...caso, motor, ia };
  });
  const totalSeg = (Date.now() - inicio) / 1000;
  stdout.write("\n\n");

  const lineas: string[] = [];
  const log = (s = "") => {
    lineas.push(s);
    console.log(s);
  };

  log(`# Motor de reglas vs. IA (${MODELO}) · prompt ${PROMPT_VERSION}`);
  log();
  let invMotor = 0;
  let invIa = 0;
  let celdas = 0;
  let distintas = 0;
  const cambios: Record<string, number> = {};
  const detalle: string[] = [];

  for (const puesto of PUESTOS) {
    const delPuesto = filas.filter((f) => f.puesto.id === puesto.id);
    if (delPuesto.length === 0) continue;
    log(`## ${puesto.id}. ${puesto.titulo}`);
    log();
    log("```");
    log(`${pad("Candidato", 24)} ${pad("Ajuste", 11)} ${padIzq("Motor", 6)} ${pad("", 9)} ${padIzq("IA", 6)} ${pad("", 9)} Requisitos M→IA`);
    for (const fila of delPuesto) {
      const codigos = puesto.requisitos
        .map((r) => {
          const m = fila.motor.porRequisito.get(r.id)?.assessment;
          const i = fila.ia.ok ? fila.ia.porRequisito.get(r.id)?.assessment : undefined;
          if (m && i) {
            celdas++;
            if (m !== i) {
              distintas++;
              const clave = `${CODIGO[m]}→${CODIGO[i]}`;
              cambios[clave] = (cambios[clave] ?? 0) + 1;
              detalle.push(
                `- ${puesto.titulo} · ${apellidos(fila.candidato.nombre)} · ${r.corto}: motor **${m}** → IA **${i}**. ` +
                  `IA: ${(fila.ia.ok ? fila.ia.porRequisito.get(r.id)?.rationale ?? "" : "").replace(/\s+/g, " ").slice(0, 220)}`,
              );
            }
            return m === i ? CODIGO[m] : `${CODIGO[m]}${CODIGO[i]}`;
          }
          return "?";
        })
        .join(" ");
      const ia = fila.ia.ok ? `${padIzq(fila.ia.score.toFixed(0), 5)} % ${pad(fila.ia.nivel, 9)}` : `${pad("error", 17)}`;
      log(
        `${pad(apellidos(fila.candidato.nombre), 24)} ${pad(ETIQUETA_AJUSTE[fila.candidato.ajuste], 11)} ` +
          `${padIzq(fila.motor.score.toFixed(0), 5)} % ${pad(fila.motor.nivel, 9)} ${ia} ${codigos}`,
      );
    }
    log("```");
    const im = inversiones(delPuesto, (f) => f.motor.score);
    const ii = inversiones(delPuesto, (f) => (f.ia.ok ? f.ia.score : null));
    invMotor += im.length;
    invIa += ii.length;
    log(`Orden: motor ${im.length === 0 ? "correcto" : `${im.length} inversión(es)`} · IA ${ii.length === 0 ? "correcto" : `${ii.length} inversión(es)`}`);
    for (const x of im) log(`  - motor: ${x}`);
    for (const x of ii) log(`  - IA: ${x}`);
    log();
  }

  const ok = filas.flatMap((f) => (f.ia.ok ? [f.ia] : []));
  const fallos = filas.filter((f) => !f.ia.ok);
  const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  log("## Resumen");
  log();
  log(`- CV evaluados: ${filas.length} (IA correcta en ${ok.length}; fallos: ${fallos.length})`);
  for (const f of fallos) log(`  - ${apellidos(f.candidato.nombre)}: ${f.ia.ok ? "" : f.ia.motivo}`);
  log(`- Inversiones de orden: motor ${invMotor} · IA ${invIa}`);
  log(`- Requisitos con valoración distinta: ${distintas} de ${celdas} (${celdas ? ((100 * distintas) / celdas).toFixed(0) : 0} %)`);
  log(`  - Cambios (motor→IA; A acreditado, N no cumplido, - sin evidencia, P pendiente): ${Object.entries(cambios).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(", ") || "ninguno"}`);
  log(`- Tiempo por CV: ${prom(ok.map((r) => r.segundos)).toFixed(1)} s de media (máx. ${Math.max(0, ...ok.map((r) => r.segundos)).toFixed(1)} s)`);
  log(`- Tokens por CV: ${prom(ok.map((r) => r.entrada)).toFixed(0)} de entrada y ${prom(ok.map((r) => r.salida)).toFixed(0)} de salida (media)`);
  log(`- Total: ${totalSeg.toFixed(0)} s con ${CONCURRENCIA} en paralelo → ~${Math.round((filas.length / totalSeg) * 3600)} CV/hora a este ritmo`);
  log();
  log("## Requisitos donde difieren");
  log();
  for (const d of detalle) log(d);

  if (SALIDA) {
    await writeFile(SALIDA, `${lineas.join("\n")}\n`, "utf8");
    console.log(`\nInforme guardado en ${SALIDA}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});

