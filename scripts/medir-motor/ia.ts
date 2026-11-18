// Compara el motor de reglas con la evaluación con IA (cola + worker) sobre el banco de CV
// ficticios de cv-prueba/, y mide el rendimiento real del worker: segundos y tokens por CV.
//
// La IA se llama EXACTAMENTE como en producción: mismo prompt (ai/input.ts), mismo
// transporte (ia-worker/src/cli.ts → `claude -p` con la suscripción) y la misma
// validación (interpretAiResponse: citas literales, requisitos legales nunca acreditados).
// No toca la base de datos. Consume del plan de Claude: imprime lo previsto y espera 5 s.
//
// Uso:
//   npm run medir:ia                                   (todos los puestos, claude-haiku-5-5, el de producción)
//   npm run medir:ia -- --puesto 2 --modelo claude-opus-5-5 --concurrencia 3
//   npm run medir:ia -- --max 4 --salida informe.md
//   npm run medir:ia -- --guardar crudo.json           (guarda las respuestas de la IA)
//   npm run medir:ia -- --desde crudo.json             (re-analiza SIN llamar a la IA: no gasta plan)
//   npm run medir:ia -- --sin-notas                    (sin las dudas del motor en el prompt, para comparar)
//   npm run medir:ia -- --resumen resumen.json         (cifras clave en JSON, para la vigilancia semanal)
//
// Dos verdades de contraste:
//  1. El ORDEN de los candidatos de cada puesto (`ajuste` en datos.ts): un candidato
//     más fuerte no debería puntuar menos que uno más débil.
//  2. La VARA (gold-standard.ts), requisito por requisito: dónde acierta la IA y dónde
//     el motor, separado por el tipo de duda del motor. Incluye la política real
//     «el motor decide; en lo que duda, releva la IA».

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { assembleEvaluation } from "../../src/modules/evaluation/assemble";
import { engineNotesForText, hasEngineDoubt } from "../../src/modules/evaluation/ai/engine-notes";
import { AI_OUTPUT_JSON_SCHEMA, buildAiInput } from "../../src/modules/evaluation/ai/input";
import { PROMPT_VERSION } from "../../src/modules/evaluation/ai/prompt";
import { extractEquivalenceVotes, interpretAiResponse, InvalidAiResponseError, type EquivalenceVote } from "../../src/modules/evaluation/ai/response";
import { isLearnableVote, requirementKey } from "../../src/modules/evaluation/learned";
import type { Assessment, CompatibilityLevel, ItemAssessment } from "../../src/modules/evaluation/types";
import { extractRawText } from "../../src/modules/resumes/extraction-core";
import { runClaude } from "../../ia-worker/src/cli";
import { CODIGO, evaluarTexto, apellidos, pad, padIzq } from "./evaluar";
import { ETIQUETA_AJUSTE, FECHA_REFERENCIA, ORDEN_AJUSTE, PUESTOS, type CandidatoFixture, type PuestoFixture } from "./datos";
import { GOLD } from "./gold-standard";

const RAIZ_CV = resolve(import.meta.dirname, "..", "..", "cv-prueba");

function opcion(nombre: string): string | undefined {
  const i = argv.indexOf(`--${nombre}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const MODELO = opcion("modelo") ?? "claude-haiku-5-5";
const CONCURRENCIA = Math.min(4, Math.max(1, Number(opcion("concurrencia") ?? 2)));
const PUESTO = opcion("puesto") ? Number(opcion("puesto")) : undefined;
const MAX = opcion("max") ? Number(opcion("max")) : undefined;
const SALIDA = opcion("salida");
const GUARDAR = opcion("guardar");
const DESDE = opcion("desde");
const RESUMEN = opcion("resumen");

/** Cifras contra la vara (fracciones de 0 a 1), para el resumen en JSON. */
type VaraResumen = {
  casillas: number;
  motor: number;
  ia: number;
  motorIa: number;
  /** Contando «pendiente» = «sin evidencia» (mismo efecto en el puntaje). */
  motorIaLaxo: number;
  iaLaxo: number;
  /** El error más caro: la IA acredita lo que la vara no acredita. */
  iaAcreditoDeMas: number;
};
const SIN_NOTAS = argv.includes("--sin-notas");
const CLI = process.env.IA_WORKER_CLI_PATH || "claude";
const TIMEOUT_MS = 480_000;

type Caso = { puesto: PuestoFixture; candidato: CandidatoFixture };

type ResultadoIa =
  | {
      ok: true;
      score: number;
      nivel: CompatibilityLevel;
      porRequisito: Map<string, ItemAssessment>;
      /** Votos para que el motor aprenda (desde ia-prompt-v4). */
      votos?: EquivalenceVote[];
      segundos: number;
      entrada: number;
      salida: number;
      modelo: string;
    }
  | { ok: false; motivo: string; segundos: number };

type Fila = Caso & {
  motor: { score: number; nivel: CompatibilityLevel; porRequisito: Map<string, ItemAssessment> };
  ia: ResultadoIa;
};

/** Respuestas de la IA guardadas con --guardar (el motor se recalcula al cargar: es determinista). */
type Crudo = {
  modelo: string;
  prompt: string;
  conNotas: boolean;
  totalSeg: number;
  filas: {
    puesto: number;
    archivo: string;
    ia: (Omit<Extract<ResultadoIa, { ok: true }>, "porRequisito"> & { items: ItemAssessment[] }) | Extract<ResultadoIa, { ok: false }>;
  }[];
};

async function textoDe(caso: Caso): Promise<string> {
  const bytes = await readFile(join(RAIZ_CV, caso.puesto.carpeta, caso.candidato.archivo));
  return extractRawText(new Uint8Array(bytes), "pdf");
}

async function evaluarConIa(puesto: PuestoFixture, texto: string): Promise<ResultadoIa> {
  // Igual que producción (ai-worker-api.ts): el prompt lleva las dudas del motor sobre el mismo texto.
  const input = buildAiInput({
    vacancyTitle: puesto.titulo,
    requirements: puesto.requisitos,
    fullText: texto,
    maxChars: 30_000,
    engineNotes: SIN_NOTAS ? undefined : engineNotesForText(texto, puesto.requisitos, FECHA_REFERENCIA),
  });
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
      votos: extractEquivalenceVotes(outcome.output, puesto.requisitos, input.evaluatedText),
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

type CasillaVara = {
  quien: string;
  req: string;
  vara: Assessment;
  nota: string;
  motor: ItemAssessment;
  ia: Assessment;
  iaMotivo: string;
};

/** Grupo según lo que hizo el motor: es lo que decide si la IA interviene. */
function grupoDe(m: ItemAssessment): string {
  if (m.signal) return `duda: ${m.signal}`;
  if (m.assessment === "pendiente_verificacion") return "pendiente sin marca";
  if (m.assessment === "sin_evidencia") return "sin evidencia";
  return "acreditado sin duda";
}

/** Requisito por requisito contra la vara, separado por tipo de duda del motor. */
function informeVara(filas: Fila[], log: (s?: string) => void): VaraResumen | null {
  const casillas: CasillaVara[] = [];
  let revisar = 0;
  for (const f of filas) {
    const gold = GOLD[f.candidato.archivo];
    if (!f.ia.ok || !gold) continue;
    for (const r of f.puesto.requisitos) {
      const g = gold[r.id];
      const m = f.motor.porRequisito.get(r.id);
      const i = f.ia.porRequisito.get(r.id);
      if (!g || !m || !i) continue;
      if (g.revisar) {
        revisar++;
        continue;
      }
      casillas.push({
        quien: `${apellidos(f.candidato.nombre)} · ${r.corto}`,
        req: r.corto,
        vara: g.assessment,
        nota: g.nota,
        motor: m,
        ia: i.assessment,
        iaMotivo: i.rationale.replace(/\s+/g, " ").slice(0, 200),
      });
    }
  }
  if (casillas.length === 0) return null;

  const pct = (a: number, n: number) => (n === 0 ? "  -  " : `${padIzq(((100 * a) / n).toFixed(0), 3)} %`);
  // Política real (ai/relay.ts): el motor decide; donde duda, cuenta la IA si dice «cumple» o «no cumple».
  const politica = (c: CasillaVara) =>
    hasEngineDoubt(c.motor) && (c.ia === "acreditado" || c.ia === "no_cumplido") ? c.ia : c.motor.assessment;

  log("## Contra la vara (requisito por requisito)");
  log();
  log(`Casillas firmes: ${casillas.length} (${revisar} «por revisar» fuera de la métrica). Acierto = mismo veredicto que la vara.`);
  log();
  log("```");
  log(`${pad("Lo que hizo el motor", 30)} ${padIzq("Casillas", 8)} ${padIzq("Motor", 8)} ${padIzq("IA", 8)} ${padIzq("Motor+IA", 9)}`);
  const grupos = [...new Set(casillas.map((c) => grupoDe(c.motor)))].sort();
  const fila = (nombre: string, cs: CasillaVara[]) => {
    const m = cs.filter((c) => c.motor.assessment === c.vara).length;
    const i = cs.filter((c) => c.ia === c.vara).length;
    const p = cs.filter((c) => politica(c) === c.vara).length;
    log(`${pad(nombre, 30)} ${padIzq(String(cs.length), 8)} ${padIzq(pct(m, cs.length), 8)} ${padIzq(pct(i, cs.length), 8)} ${padIzq(pct(p, cs.length), 9)}`);
  };
  for (const g of grupos) fila(g, casillas.filter((c) => grupoDe(c.motor) === g));
  fila("TOTAL", casillas);
  log("```");
  log("«Motor+IA» = la política real: el motor decide y, donde duda, releva la IA.");
  // «Pendiente» y «sin evidencia» cuentan igual en el puntaje (ambos «por confirmar»).
  const porConfirmar = (a: Assessment) => a === "pendiente_verificacion" || a === "sin_evidencia";
  const equivale = (a: Assessment, b: Assessment) => a === b || (porConfirmar(a) && porConfirmar(b));
  const tasa = (f: (c: CasillaVara) => Assessment) => pct(casillas.filter((c) => equivale(f(c), c.vara)).length, casillas.length).trim();
  log(
    `Tratando «pendiente» y «sin evidencia» como iguales (mismo efecto en el puntaje): ` +
      `motor ${tasa((c) => c.motor.assessment)} · IA ${tasa((c) => c.ia)} · Motor+IA ${tasa(politica)}.`,
  );
  log();

  const lista = (titulo: string, cs: CasillaVara[], detalle: (c: CasillaVara) => string) => {
    log(`### ${titulo} (${cs.length})`);
    log();
    if (cs.length === 0) log("- (ninguna)");
    for (const c of cs) log(`- ${c.quien}: ${detalle(c)}`);
    log();
  };
  const v = (a: Assessment) => CODIGO[a];
  lista(
    "IA acreditó de más (la vara no acredita) — el error más caro",
    casillas.filter((c) => c.ia === "acreditado" && c.vara !== "acreditado"),
    (c) => `vara ${v(c.vara)} (${c.nota}) · motor ${v(c.motor.assessment)} · IA: ${c.iaMotivo}`,
  );
  lista(
    "IA recuperó mérito que el motor no acreditó",
    casillas.filter((c) => c.vara === "acreditado" && c.motor.assessment !== "acreditado" && c.ia === "acreditado"),
    (c) => `motor ${v(c.motor.assessment)}${c.motor.signal ? ` (${c.motor.signal})` : ""} → IA A`,
  );
  lista(
    "IA no acreditó lo que el motor acreditó bien",
    casillas.filter((c) => c.vara === "acreditado" && c.motor.assessment === "acreditado" && c.ia !== "acreditado"),
    (c) => `IA ${v(c.ia)}: ${c.iaMotivo}`,
  );
  lista(
    "Errores del motor que la IA detectó (motor acreditó de más)",
    casillas.filter((c) => c.motor.assessment === "acreditado" && c.vara !== "acreditado" && c.ia === c.vara),
    (c) => `vara ${v(c.vara)} (${c.nota})`,
  );

  // Todos los desacuerdos IA–vara, por tipo (vara→IA): para calibrar el prompt.
  const desacuerdos = casillas.filter((c) => c.ia !== c.vara);
  const tipos = [...new Set(desacuerdos.map((c) => `${v(c.vara)}→${v(c.ia)}`))].sort(
    (a, b) => desacuerdos.filter((c) => `${v(c.vara)}→${v(c.ia)}` === b).length - desacuerdos.filter((c) => `${v(c.vara)}→${v(c.ia)}` === a).length,
  );
  log(`### Desacuerdos IA–vara por tipo (vara→IA): ${desacuerdos.length}`);
  log();
  for (const t of tipos) {
    const cs = desacuerdos.filter((c) => `${v(c.vara)}→${v(c.ia)}` === t);
    log(`- **${t}** ×${cs.length}`);
    for (const c of cs) log(`  - ${c.quien} [${grupoDe(c.motor)}] · vara: ${c.nota} · IA: ${c.iaMotivo}`);
  }
  log();

  const frac = (f: (c: CasillaVara) => boolean) => casillas.filter(f).length / casillas.length;
  return {
    casillas: casillas.length,
    motor: frac((c) => c.motor.assessment === c.vara),
    ia: frac((c) => c.ia === c.vara),
    motorIa: frac((c) => politica(c) === c.vara),
    motorIaLaxo: frac((c) => equivale(politica(c), c.vara)),
    iaLaxo: frac((c) => equivale(c.ia, c.vara)),
    iaAcreditoDeMas: casillas.filter((c) => c.ia === "acreditado" && c.vara !== "acreditado").length,
  };
}

/**
 * Simulación del aprendizaje: con los votos de la IA en estos CV, ¿qué reglas
 * aprendería el motor? (Mismo filtro que producción: solo dudas de vocabulario.
 * En producción, además, pasa por el segundo juez.)
 */
function informeAprendizaje(filas: Fila[], log: (s?: string) => void): void {
  const reglas = new Map<string, { termino: string; requisito: string; a: Set<string>; contra: Set<string> }>();
  let votos = 0;
  for (const f of filas) {
    if (!f.ia.ok) continue;
    for (const v of f.ia.votos ?? []) {
      const req = f.puesto.requisitos.find((r) => r.id === v.requirementId);
      if (!req || !isLearnableVote(f.motor.porRequisito.get(v.requirementId), v.equivalent)) continue;
      votos++;
      const clave = `${requirementKey(req)}|${v.term}`;
      const r = reglas.get(clave) ?? { termino: v.display, requisito: `${f.puesto.titulo} · ${req.corto}`, a: new Set(), contra: new Set() };
      (v.equivalent ? r.a : r.contra).add(f.candidato.archivo);
      reglas.set(clave, r);
    }
  }
  log("## Aprendizaje simulado (votos de la IA en dudas de vocabulario)");
  log();
  log(`Votos válidos: ${votos} · reglas candidatas: ${reglas.size}. Con el mínimo por defecto (1 CV), todas pasan al segundo juez, que decide.`);
  log();
  if (reglas.size === 0) return;
  log("| En el CV dice | Requisito | La IA del CV: cuenta | No cuenta |");
  log("|---|---|---:|---:|");
  for (const r of [...reglas.values()].sort((x, y) => y.a.size + y.contra.size - (x.a.size + x.contra.size))) {
    log(`| «${r.termino}» | ${r.requisito} | ${r.a.size} | ${r.contra.size} |`);
  }
  log();
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

  let filas: Fila[];
  let totalSeg: number;
  let conNotas = !SIN_NOTAS;
  if (DESDE) {
    const crudo = JSON.parse(await readFile(DESDE, "utf8")) as Crudo;
    conNotas = crudo.conNotas;
    totalSeg = crudo.totalSeg;
    filas = [];
    for (const caso of casos) {
      const guardado = crudo.filas.find((f) => f.puesto === caso.puesto.id && f.archivo === caso.candidato.archivo);
      if (!guardado) continue;
      const motor = evaluarTexto(caso.puesto, await textoDe(caso));
      const ia: ResultadoIa = guardado.ia.ok
        ? { ...guardado.ia, porRequisito: new Map(guardado.ia.items.map((i) => [i.requirementId, i])) }
        : guardado.ia;
      filas.push({ ...caso, motor, ia });
    }
    console.log(`Re-análisis de ${DESDE} (${filas.length} CV, prompt ${crudo.prompt}, ${crudo.modelo}): no se llama a la IA.\n`);
  } else {
    console.log(
      `Se evaluarán ${casos.length} CV ficticios con ${MODELO} (${CONCURRENCIA} en paralelo, ${conNotas ? "con" : "SIN"} las dudas del motor), con la suscripción de Claude.`,
    );
    console.log("Ctrl+C en los próximos 5 s para cancelar…");
    await new Promise((r) => setTimeout(r, 5_000));

    const inicio = Date.now();
    let hechos = 0;
    filas = await enParalelo(casos, CONCURRENCIA, async (caso): Promise<Fila> => {
      const texto = await textoDe(caso);
      const motor = evaluarTexto(caso.puesto, texto);
      const ia = await evaluarConIa(caso.puesto, texto);
      hechos++;
      stdout.write(`\r  ${hechos}/${casos.length} evaluados…`);
      return { ...caso, motor, ia };
    });
    totalSeg = (Date.now() - inicio) / 1000;
    stdout.write("\n\n");
    if (GUARDAR) {
      const crudo: Crudo = {
        modelo: MODELO,
        prompt: PROMPT_VERSION,
        conNotas,
        totalSeg,
        filas: filas.map((f) => ({
          puesto: f.puesto.id,
          archivo: f.candidato.archivo,
          ia: f.ia.ok ? { ...f.ia, porRequisito: undefined, items: [...f.ia.porRequisito.values()] } : f.ia,
        })),
      };
      await writeFile(GUARDAR, `${JSON.stringify(crudo, null, 2)}\n`, "utf8");
      console.log(`Respuestas guardadas en ${GUARDAR} (re-analice con --desde, sin gastar plan).\n`);
    }
  }

  const lineas: string[] = [];
  const log = (s = "") => {
    lineas.push(s);
    console.log(s);
  };

  log(`# Motor de reglas vs. IA (${MODELO}) · prompt ${PROMPT_VERSION} ${conNotas ? "con" : "SIN"} las dudas del motor`);
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
  const vara = informeVara(filas, log);
  informeAprendizaje(filas, log);

  if (RESUMEN) {
    const resumen = {
      fecha: new Date().toISOString(),
      modelo: MODELO,
      prompt: PROMPT_VERSION,
      conNotas,
      cv: filas.length,
      fallos: fallos.length,
      inversionesMotor: invMotor,
      inversionesIa: invIa,
      segundosPorCv: Number(prom(ok.map((r) => r.segundos)).toFixed(1)),
      vara,
    };
    await writeFile(RESUMEN, `${JSON.stringify(resumen, null, 2)}\n`, "utf8");
    console.log(`Resumen guardado en ${RESUMEN}`);
  }

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

