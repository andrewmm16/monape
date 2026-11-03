import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { FakeBumeranAdapter } from "../adapters/fake-bumeran";
import { FakeComputrabajoAdapter } from "../adapters/fake-computrabajo";
import { FakeIndeedAdapter } from "../adapters/fake-indeed";
import { FakeLinkedinAdapter } from "../adapters/fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "../adapters/fake-trabajos-diarios";
import { mutacionesDe } from "../fake-portal/mutations";
import { PORTAL_SLUGS, type PortalSlug } from "../fake-portal/model";
import { startFakePortal } from "../fake-portal/server";
import { FileIncidentStore, sanitizeText, type Incident } from "../incidents";
import { configureSelectorState, getBook, readTolerances, resetSelectorState, tolerante } from "../selectors";
import type { PortalAdapter } from "../types";
import { askModel, type Complete } from "./client";
import { buildPrompt, type RetryInput } from "./prompt";
import { validateProposal } from "./proposals";
import { rehearseOnAdapter } from "./trial";

/**
 * MEDICIÓN de un modelo de reparación contra los portales FICTICIOS: por cada (portal × cambio estructural) se
 * arranca un portal propio en memoria, se aplica el cambio, se obtiene el fallo real de la prueba de estructura,
 * se registra el incidente con su esquema, se consulta al modelo y se ENSAYA su propuesta, igual que el servicio real.
 * Todo el estado (incidentes, overrides, tolerancias) vive en una carpeta temporal: no toca `bot/.state/` ni el puerto 4011.
 * NO es una prueba contra portales reales: solo mide al modelo sobre los cambios que sabe producir el mutador.
 */

export type Resultado =
  | "probada"
  | "sin_probar"
  | "fallo_ensayo"
  | "sin_propuesta"
  | "propuesta_invalida"
  | "error_consulta"
  | "absorbido"
  // Fuera de la lista pedida pero necesarios para no mentir: el cambio no lo nota la prueba (ni la tolerancia lo usó) o falló la propia herramienta.
  | "no_detectado"
  | "error_medicion";

export const RESULTADOS: readonly Resultado[] = ["probada", "sin_probar", "fallo_ensayo", "sin_propuesta", "propuesta_invalida", "error_consulta", "absorbido", "no_detectado", "error_medicion"];

export interface Caso {
  portal: PortalSlug;
  mutacion: string;
  descripcion: string;
}

export interface ResultadoCaso extends Caso {
  repeticion: number;
  resultado: Resultado;
  /** Resultado del primer intento (igual a `resultado` con un solo intento). */
  resultadoPrimero: Resultado;
  intentos: number;
  tokensEntrada: number;
  tokensSalida: number;
  /** Tiempo total esperando al modelo (todos los intentos), en milisegundos. */
  latenciaMs: number;
  /** Clave del libro afectada, según el mensaje del fallo real. */
  claveAfectada: string | null;
  claveModelo: string | null;
  selectorModelo: string | null;
  razon: string;
  /** Mensaje saneado del fallo real de la prueba de estructura (o motivo del descarte). */
  mensaje: string;
}

export interface MedicionOptions {
  complete: Complete;
  model: string;
  /** Texto de cabecera: `simulado`, `anthropic`, `openai`. */
  proveedor: string;
  /** Servidor sin claves (cabecera del informe). */
  servidor: string;
  portal?: string;
  max?: number;
  repeticiones?: number;
  /** Intentos por caso: 1 mide solo el primero (sin reintento con el error del ensayo). */
  intentos?: number;
  /**
   * Quita las alternativas tolerantes de `campo_titulo` (solo durante la medición, se restaura al terminar el caso) para que
   * `renombrar_campo` ya no lo absorba la tolerancia y llegue al modelo: es el único cambio que un selector nuevo sí arregla.
   */
  sinTolerancia?: boolean;
  /** Para pruebas: avisos de progreso. */
  log?: (message: string) => void;
  /** Carpeta de trabajo temporal; por defecto una nueva en la del sistema (se borra al terminar). */
  workDir?: string;
  now?: () => Date;
}

export interface Medicion {
  fecha: string;
  proveedor: string;
  modelo: string;
  servidor: string;
  casosDistintos: number;
  repeticiones: number;
  intentosMax: number;
  resultados: ResultadoCaso[];
}

const BUILDERS: Record<PortalSlug, new (context: BrowserContext, baseUrl: string, timeoutMs?: number) => PortalAdapter> = {
  linkedin: FakeLinkedinAdapter,
  bumeran: FakeBumeranAdapter,
  "trabajos-diarios": FakeTrabajosDiariosAdapter,
  indeed: FakeIndeedAdapter,
  computrabajo: FakeComputrabajoAdapter,
};

/** Espera por cada forma de buscar un elemento durante la medición (las páginas son locales). */
const ADAPTER_TIMEOUT_MS = 2_000;

const ANSI = /\u001b\[[0-9;]*m/g;
const oneLine = (text: string, max: number) => sanitizeText(text.replace(ANSI, "").replace(/[\r\n]+/g, " "), max);

/**
 * Casos medibles: cada (portal × mutación estructural). Se reparten a turnos entre portales (la 1.ª mutación de cada
 * portal, luego la 2.ª…) para que `--max N` no se quede con un solo portal.
 */
export function listarCasos(options: { portal?: string; max?: number } = {}): Caso[] {
  const portales = PORTAL_SLUGS.filter((slug) => !options.portal || slug === options.portal);
  const porPortal = portales.map((portal) => mutacionesDe(portal, "estructural").map((m): Caso => ({ portal, mutacion: m.id, descripcion: m.descripcion })));
  const casos: Caso[] = [];
  for (let i = 0; porPortal.some((list) => i < list.length); i++) {
    for (const list of porPortal) if (list[i]) casos.push(list[i]!);
  }
  return options.max !== undefined ? casos.slice(0, options.max) : casos;
}

/** Clave del libro que nombra el mensaje del fallo, p. ej. «… [campo_titulo]». */
export function claveDelMensaje(portal: string, mensaje: string): string | null {
  const book = getBook(portal);
  for (const match of mensaje.matchAll(/\[([a-z0-9_]+)\]/g)) {
    if (book && Object.hasOwn(book, match[1]!)) return match[1]!;
  }
  return null;
}

/**
 * Modelo SIMULADO y determinista (sin red ni costo) para validar la herramienta: lee la clave afectada del mensaje del
 * fallo y propone el selector ORIGINAL de esa clave en el libro, adaptado a lo que muestra el esquema de la pantalla
 * cuando el cambio fue un renombrado (`#titulo` → `#titulo-v2`). Si no hay clave identificable, responde «sin propuesta».
 */
export function modeloSimulado(): Complete {
  return async ({ prompt }) => {
    const answer = (value: { sin_propuesta: boolean; clave: string; selector: string; razon: string }) => ({
      text: JSON.stringify({ confianza: "media", ...value }),
      stopReason: "end_turn",
      tokensEntrada: Math.ceil(prompt.length / 4),
      tokensSalida: 60,
    });
    const portal = /^Portal: (.+)$/m.exec(prompt)?.[1] ?? "";
    const mensaje = /^Mensaje \(saneado\): (.*)$/m.exec(prompt)?.[1] ?? "";
    const clave = claveDelMensaje(portal, mensaje);
    if (!clave) return answer({ sin_propuesta: true, clave: "", selector: "", razon: "No se identifica la clave afectada en el mensaje." });
    const actual = new RegExp(`^- ${clave}: .*?Selector actual: ([^\\n]*?)(?:\\. Alternativas: .*)?$`, "m").exec(prompt)?.[1] ?? "";
    const id = /^#([\w-]+)$/.exec(actual)?.[1];
    const name = /^\[name=["']?([\w-]+)["']?\]$/.exec(actual)?.[1];
    // Si el esquema ya muestra la variante «_v2» / «-v2» del id o del name originales, esa es la que vale.
    let selector = actual;
    if (id && prompt.includes(`"id":"${id}-v2"`)) selector = `#${id}-v2`;
    else if (name && prompt.includes(`"name":"${name}_v2"`)) selector = `[name=${name}_v2]`;
    return answer({ sin_propuesta: false, clave, selector, razon: `Se propone el selector original de ${clave} (simulado).` });
  };
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

/** Un caso: portal nuevo, cambio, fallo real, incidente, consulta(s) al modelo y ensayo(s). Nunca lanza. */
async function medirCaso(browser: Browser, caso: Caso, repeticion: number, options: MedicionOptions, root: string, intentosMax: number): Promise<ResultadoCaso> {
  const base: ResultadoCaso = {
    ...caso,
    repeticion,
    resultado: "error_medicion",
    resultadoPrimero: "error_medicion",
    intentos: 0,
    tokensEntrada: 0,
    tokensSalida: 0,
    latenciaMs: 0,
    claveAfectada: null,
    claveModelo: null,
    selectorModelo: null,
    razon: "",
    mensaje: "",
  };
  const finish = (resultado: Resultado, patch: Partial<ResultadoCaso> = {}): ResultadoCaso => ({ ...base, resultado, resultadoPrimero: base.resultadoPrimero === "error_medicion" ? resultado : base.resultadoPrimero, ...patch });

  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, "caso-")); // carpeta nueva por caso: nunca se mezclan incidentes de otro caso
  configureSelectorState({ overridesFile: path.join(dir, "selectores.json"), tolerancesFile: path.join(dir, "tolerancias.json") });
  const book = getBook(caso.portal);
  const tituloOriginal = book?.campo_titulo;
  if (options.sinTolerancia && caso.mutacion === "renombrar_campo" && book && tituloOriginal) {
    book.campo_titulo = tolerante(tituloOriginal.descripcion, tituloOriginal.selector, []);
  }
  const portal = await startFakePortal(0);
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext();
    const adapter = new BUILDERS[caso.portal](context, portal.url, ADAPTER_TIMEOUT_MS);
    portal.mutator.apply(caso.portal, caso.mutacion);

    let failure: unknown = null;
    try {
      await adapter.healthCheck();
    } catch (error) {
      failure = error;
    }
    if (failure === null) {
      // La prueba pasa con el cambio aplicado: o la tolerancia lo absorbió (hay evento) o la prueba no lo nota.
      const tolerado = readTolerances().length > 0;
      return finish(tolerado ? "absorbido" : "no_detectado", { mensaje: tolerado ? "la prueba de estructura pasa usando un selector alternativo" : "la prueba de estructura pasa sin notar el cambio" });
    }

    const store = new FileIncidentStore(path.join(dir, "incidentes"), () => {});
    await store.record({ portal: adapter.slug, step: "prueba_estructura", error: failure, captureStructure: () => adapter.captureStructure?.() ?? Promise.resolve(null) });
    const incident: Incident | undefined = (await store.list())[0];
    if (!incident) return finish("error_medicion", { mensaje: "no se pudo guardar el incidente" });
    base.mensaje = oneLine(incident.message, 200);
    base.claveAfectada = claveDelMensaje(incident.portal, incident.message);
    if (!incident.reparable || !incident.structure) {
      return finish("sin_propuesta", { mensaje: base.mensaje, razon: "incidente no reparable o sin esquema: no hay con qué consultar" });
    }

    let retry: RetryInput | undefined;
    let lastSelector: string | undefined;
    for (let attempt = 1; attempt <= intentosMax; attempt++) {
      base.intentos = attempt;
      const { system, prompt } = buildPrompt({ incident, retry });
      const started = Date.now();
      let answer: Awaited<ReturnType<typeof askModel>>;
      try {
        answer = await askModel(options.complete, { model: options.model, system, prompt });
      } catch (error) {
        base.latenciaMs += Date.now() - started;
        return finish("error_consulta", { razon: oneLine(String(error instanceof Error ? error.message : error), 200) });
      }
      base.latenciaMs += Date.now() - started;
      base.tokensEntrada += answer.tokensEntrada;
      base.tokensSalida += answer.tokensSalida;
      if (!answer.ok) return finish("sin_propuesta", { razon: answer.motivo });
      base.razon = oneLine(answer.respuesta.razon, 160);
      const valid = validateProposal(incident.portal, answer.respuesta);
      if (!valid.ok) return finish("propuesta_invalida", { razon: valid.motivo, claveModelo: answer.respuesta.clave.slice(0, 60) || null, selectorModelo: answer.respuesta.selector.slice(0, 120) || null });
      base.claveModelo = valid.clave;
      base.selectorModelo = valid.selector;
      // Como el servicio real: repetir el selector que ya falló detiene los intentos.
      if (retry && valid.selector === lastSelector) return finish("fallo_ensayo", { razon: "el modelo repitió el selector que ya falló" });
      lastSelector = valid.selector;

      let trial: Awaited<ReturnType<typeof rehearseOnAdapter>>;
      try {
        trial = await rehearseOnAdapter(adapter, valid.clave, valid.selector, incident.step);
      } catch (error) {
        trial = { resultado: "fallo", mensaje: oneLine(String(error instanceof Error ? error.message : error), 300) };
      }
      const resultado: Resultado = trial.resultado === "paso" ? "probada" : trial.resultado === "no_cubierto" ? "sin_probar" : "fallo_ensayo";
      if (attempt === 1) base.resultadoPrimero = resultado;
      if (resultado !== "fallo_ensayo" || attempt === intentosMax) return finish(resultado, { mensaje: base.mensaje });
      retry = { attempt: attempt + 1, maxAttempts: intentosMax, clave: valid.clave, selector: valid.selector, mensaje: trial.mensaje, estructura: trial.estructura };
    }
    return finish("fallo_ensayo");
  } catch (error) {
    return finish("error_medicion", { mensaje: oneLine(String(error instanceof Error ? error.message : error), 200) });
  } finally {
    if (book && tituloOriginal) book.campo_titulo = tituloOriginal;
    await context?.close().catch(() => undefined);
    await portal.close().catch(() => undefined);
    resetSelectorState();
  }
}

/** Ejecuta toda la medición. Los casos van de uno en uno (el estado de selectores es global del proceso). */
export async function medir(options: MedicionOptions): Promise<Medicion> {
  const casos = listarCasos({ portal: options.portal, max: options.max });
  const repeticiones = Math.max(1, options.repeticiones ?? 1);
  const intentosMax = Math.max(1, options.intentos ?? 1);
  const log = options.log ?? (() => {});
  const root = options.workDir ?? mkdtempSync(path.join(tmpdir(), "medicion-reparacion-"));
  const resultados: ResultadoCaso[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    let n = 0;
    const total = casos.length * repeticiones;
    for (const caso of casos) {
      for (let repeticion = 1; repeticion <= repeticiones; repeticion++) {
        n++;
        const result = await medirCaso(browser, caso, repeticion, options, root, intentosMax);
        resultados.push(result);
        log(`[${n}/${total}] ${caso.portal} / ${caso.mutacion}${repeticiones > 1 ? ` (#${repeticion})` : ""}: ${result.resultado}`);
      }
    }
  } finally {
    await browser.close();
    if (!options.workDir) rmSync(root, { recursive: true, force: true });
  }
  return {
    fecha: (options.now ?? (() => new Date()))().toISOString(),
    proveedor: options.proveedor,
    modelo: options.model,
    servidor: options.servidor,
    casosDistintos: casos.length,
    repeticiones,
    intentosMax,
    resultados,
  };
}

// ------------------------------------------------------------------------------------------------ informe

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const pct = (part: number, total: number) => (total === 0 ? "—" : `${((100 * part) / total).toFixed(0)} %`);
const seg = (ms: number) => (ms / 1000).toFixed(1);

function agrupar(resultados: ResultadoCaso[], clave: (r: ResultadoCaso) => string): string[] {
  const groups = new Map<string, ResultadoCaso[]>();
  for (const r of resultados) groups.set(clave(r), [...(groups.get(clave(r)) ?? []), r]);
  return [...groups.keys()].sort();
}

/** Informe en Markdown (español). Sin claves, sin postulantes y sin HTML: solo contadores, selectores y textos breves ya saneados. */
export function renderInforme(m: Medicion): string {
  const rs = m.resultados;
  const consultados = rs.filter((r) => r.intentos > 0);
  const lines: string[] = [];
  lines.push("# Medición de la reparación asistida por IA", "");
  lines.push("> **Aviso:** esta medición se hizo contra portales FICTICIOS con cambios fabricados por el mutador. **NO es una prueba contra portales reales**: un buen resultado aquí no garantiza que el modelo repare un portal real.", "");
  lines.push(`- Fecha: ${m.fecha}`);
  lines.push(`- Proveedor: ${m.proveedor}`);
  lines.push(`- Modelo: ${m.modelo}`);
  lines.push(`- Servidor: ${m.servidor}`);
  lines.push(`- Casos distintos: ${m.casosDistintos} (portal × cambio estructural); repeticiones por caso: ${m.repeticiones}; ejecuciones: ${rs.length}`);
  lines.push(`- Intentos por caso: ${m.intentosMax}${m.intentosMax === 1 ? " (se mide solo el primer intento, sin reintento)" : " (con reintento usando el error del ensayo)"}`, "");

  lines.push("## Resultado por caso", "");
  lines.push("| Portal | Cambio | Clave afectada | Resultado | Intentos | Tokens (ent/sal) | Segundos | Razón del modelo |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of rs) {
    const razon = r.razon || (r.resultado === "absorbido" || r.resultado === "no_detectado" ? r.mensaje : "");
    lines.push(
      `| ${r.portal} | ${r.mutacion}${m.repeticiones > 1 ? ` #${r.repeticion}` : ""} | ${r.claveAfectada ?? "—"} | ${r.resultado} | ${r.intentos} | ${r.tokensEntrada}/${r.tokensSalida} | ${seg(r.latenciaMs)} | ${cell(razon)} |`,
    );
  }
  lines.push("");

  lines.push("## Resumen por resultado", "");
  lines.push("| Resultado | Casos | % |", "|---|---|---|");
  for (const resultado of RESULTADOS) {
    const count = rs.filter((r) => r.resultado === resultado).length;
    if (count > 0) lines.push(`| ${resultado} | ${count} | ${pct(count, rs.length)} |`);
  }
  const probadas = rs.filter((r) => r.resultado === "probada").length;
  lines.push("", `Tasa de \`probada\` sobre todas las ejecuciones: **${pct(probadas, rs.length)}** (${probadas}/${rs.length}); sobre las que llegaron a consultar al modelo: **${pct(probadas, consultados.length)}** (${probadas}/${consultados.length}).`);
  if (m.intentosMax > 1) {
    const primero = rs.filter((r) => r.resultadoPrimero === "probada").length;
    lines.push(`Con el primer intento: ${pct(primero, rs.length)} (${primero}/${rs.length}); con hasta ${m.intentosMax} intentos: ${pct(probadas, rs.length)}.`);
  }
  lines.push("");

  const tabla = (titulo: string, clave: (r: ResultadoCaso) => string) => {
    lines.push(`## ${titulo}`, "", "| Grupo | Ejecuciones | probada | % probada | absorbido | otros |", "|---|---|---|---|---|---|");
    for (const grupo of agrupar(rs, clave)) {
      const items = rs.filter((r) => clave(r) === grupo);
      const ok = items.filter((r) => r.resultado === "probada").length;
      const abs = items.filter((r) => r.resultado === "absorbido").length;
      lines.push(`| ${grupo} | ${items.length} | ${ok} | ${pct(ok, items.length)} | ${abs} | ${items.length - ok - abs} |`);
    }
    lines.push("");
  };
  tabla("Resumen por tipo de cambio", (r) => r.mutacion);
  tabla("Resumen por portal", (r) => r.portal);

  const latencias = consultados.map((r) => r.latenciaMs);
  lines.push("## Latencia y tokens", "");
  lines.push(`- Latencia por caso (solo espera al modelo; ${consultados.length} casos consultados): media ${seg(mean(latencias))} s, p95 ${seg(p95(latencias))} s.`);
  lines.push(`- Tokens totales: ${rs.reduce((a, r) => a + r.tokensEntrada, 0)} de entrada y ${rs.reduce((a, r) => a + r.tokensSalida, 0)} de salida (el coste lo calcula quien lea esto con la tarifa vigente).`);
  lines.push(`- Los casos \`absorbido\` y \`no_detectado\` no consultan al modelo.`, "");
  return `${lines.join("\n")}\n`;
}

/** Escribe el informe `.md` y el `.json` con los mismos datos. Devuelve las rutas. */
export function escribirInforme(m: Medicion, mdPath: string): { md: string; json: string } {
  mkdirSync(path.dirname(mdPath), { recursive: true });
  const json = mdPath.replace(/\.md$/i, "") + ".json";
  writeFileSync(mdPath, renderInforme(m));
  writeFileSync(json, `${JSON.stringify(m, null, 2)}\n`);
  return { md: mdPath, json };
}

// ------------------------------------------------------------------------------------------------ línea de comandos

export interface Args {
  modo: "simulado" | "real";
  portal?: string;
  max?: number;
  repeticiones: number;
  intentos: number;
  salida?: string;
  sinTolerancia: boolean;
}

function entero(name: string, raw: string | undefined, min: number, max: number): number {
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  return value;
}

/** Interpreta los argumentos de la línea de comandos; lanza `Error` con un mensaje claro si algo no vale. */
export function parseArgs(argv: string[]): Args {
  const args: Args = { modo: "simulado", repeticiones: 1, intentos: 1, sinTolerancia: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => argv[++i];
    switch (arg) {
      case "--simulado":
        args.modo = "simulado";
        break;
      case "--real":
        args.modo = "real";
        break;
      case "--portal": {
        const slug = next();
        if (!slug || !(PORTAL_SLUGS as readonly string[]).includes(slug)) throw new Error(`--portal debe ser uno de: ${PORTAL_SLUGS.join(", ")}.`);
        args.portal = slug;
        break;
      }
      case "--max":
        args.max = entero("--max", next(), 1, 1_000);
        break;
      case "--repeticiones":
        args.repeticiones = entero("--repeticiones", next(), 1, 50);
        break;
      case "--intentos":
        args.intentos = entero("--intentos", next(), 1, 5);
        break;
      case "--sin-tolerancia":
        args.sinTolerancia = true;
        break;
      case "--salida": {
        const value = next();
        if (!value) throw new Error("--salida necesita una ruta.");
        args.salida = value;
        break;
      }
      default:
        throw new Error(`Opción desconocida: ${arg}. Opciones: --simulado, --real, --portal <slug>, --max <N>, --repeticiones <N>, --intentos <N>, --salida <ruta>, --sin-tolerancia.`);
    }
  }
  return args;
}

/** Nombre por defecto del informe: `medicion-reparacion-AAAA-MM-DD-HHmm.md` (hora local). */
export function nombreInforme(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `medicion-reparacion-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.md`;
}

/** Servidor para la cabecera: solo origen y ruta, nunca usuario, clave ni parámetros. */
export function servidorVisible(baseUrl: string | null, provider: string): string {
  if (!baseUrl) return provider === "anthropic" ? "API de Anthropic" : "(no indicado)";
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return "(dirección no válida)";
  }
}
