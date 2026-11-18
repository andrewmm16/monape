import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { FakeBumeranAdapter } from "../adapters/fake-bumeran";
import { FakeComputrabajoAdapter } from "../adapters/fake-computrabajo";
import { FakeIndeedAdapter } from "../adapters/fake-indeed";
import { FakeLinkedinAdapter } from "../adapters/fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "../adapters/fake-trabajos-diarios";
import { PORTAL_SLUGS, type PortalSlug } from "../fake-portal/model";
import { startFakePortal } from "../fake-portal/server";
import { FileIncidentStore, sanitizeText, type Incident } from "../incidents";
import { loadRepairConfig } from "../config";
import { configureSelectorState, getBook, removeOverride, resetSelectorState, setOverride, tolerante } from "../selectors";
import type { PortalAdapter } from "../types";
import { askModel, createCompleteFromConfig, type Complete } from "./client";
import { resumirMemoria } from "./memoria";
import { buildPrompt, type RetryInput } from "./prompt";
import { ProposalStore, validateProposal, type Propuesta } from "./proposals";
import { rehearseOnAdapter } from "./trial";

/**
 * ENTRENADOR del aprendizaje de la reparación, SOLO contra portales FICTICIOS. A diferencia de la medición, aquí el
 * estado (almacén de propuestas + overrides) es PERSISTENTE y se acumula entre ciclos, y las propuestas se AUTO-APRUEBAN
 * (solo en entrenamiento; el robot de producción sigue necesitando el «sí N» de una persona).
 *
 * Cada ciclo, por portal: se quita el override de `campo_titulo` (se simula que el fallo REAPARECE) conservando el
 * historial, se rompe el portal (`renombrar_campo`), se consulta al modelo CON la memoria del historial, se ensaya, se
 * auto-aplica y se verifica; la propuesta verificada se guarda. Así la memoria crece y se ve si el modelo empieza a
 * proponer «de memoria» el selector que ya funcionó. Tope de consultas al modelo para no vaciar el plan.
 *
 * Uso: npm run bot:entrenar [-- --portal <nombre>] [--max-consultas <n>] [--salida <informe.md>] [--state <carpeta>]
 */

const BUILDERS: Record<PortalSlug, new (context: BrowserContext, baseUrl: string, timeoutMs?: number) => PortalAdapter> = {
  linkedin: FakeLinkedinAdapter,
  bumeran: FakeBumeranAdapter,
  "trabajos-diarios": FakeTrabajosDiariosAdapter,
  indeed: FakeIndeedAdapter,
  computrabajo: FakeComputrabajoAdapter,
};

const ADAPTER_TIMEOUT_MS = 2_000;
const MUTACION = "renombrar_campo"; // el único cambio que un selector nuevo arregla (los demás el modelo los declina bien)
const CLAVE = "campo_titulo";
const ANSI = /\u001b\[[0-9;]*m/g;
const oneLine = (text: string, max: number) => sanitizeText(text.replace(ANSI, "").replace(/[\r\n]+/g, " "), max);

export type ResultadoCiclo = "verificada" | "no_verificada" | "sin_propuesta" | "sin_incidente" | "error";

export interface CicloResultado {
  ciclo: number;
  portal: PortalSlug;
  consultas: number;
  intentos: number;
  tokensEntrada: number;
  tokensSalida: number;
  selector: string | null;
  /** El selector propuesto ya figuraba como verificado en la memoria (propuso «de memoria»). */
  usoMemoria: boolean;
  /** Había memoria para esta clave al empezar el ciclo. */
  habiaMemoria: boolean;
  resultado: ResultadoCiclo;
  razon: string;
}

export interface EntrenarOptions {
  complete: Complete;
  model: string;
  portales: PortalSlug[];
  /** Tope de consultas al modelo (presupuesto). El entrenamiento para al alcanzarlo. */
  maxConsultas: number;
  stateDir: string;
  intentos?: number;
  log?: (message: string) => void;
  now?: () => Date;
}

/** Un ciclo: rompe el portal, consulta con memoria, auto-aplica y verifica. Nunca lanza. */
async function unCiclo(
  browser: Browser,
  portalSlug: PortalSlug,
  ciclo: number,
  store: ProposalStore,
  options: EntrenarOptions,
  idSeq: number,
): Promise<CicloResultado> {
  const now = options.now ?? (() => new Date());
  const intentosMax = Math.max(1, options.intentos ?? 2);
  const base: CicloResultado = {
    ciclo,
    portal: portalSlug,
    consultas: 0,
    intentos: 0,
    tokensEntrada: 0,
    tokensSalida: 0,
    selector: null,
    usoMemoria: false,
    habiaMemoria: false,
    resultado: "error",
    razon: "",
  };

  // Simula que el fallo reaparece: se retira el override aprobado (si lo hubiera) conservando el historial de propuestas.
  removeOverride(portalSlug, CLAVE);
  // Sin alternativas tolerantes en campo_titulo, para que el renombrado llegue al modelo (igual que la medición).
  const book = getBook(portalSlug);
  const tituloOriginal = book?.[CLAVE];
  if (book && tituloOriginal) book[CLAVE] = tolerante(tituloOriginal.descripcion, tituloOriginal.selector, []);

  const portal = await startFakePortal(0);
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext();
    const adapter = new BUILDERS[portalSlug](context, portal.url, ADAPTER_TIMEOUT_MS);
    portal.mutator.apply(portalSlug, MUTACION);

    let failure: unknown = null;
    try {
      await adapter.healthCheck();
    } catch (error) {
      failure = error;
    }
    if (failure === null) return { ...base, resultado: "sin_incidente", razon: "la prueba de estructura pasó (el fallo no reapareció)" };

    const incidents = new FileIncidentStore(path.join(portal ? mkdtempSync(path.join(options.stateDir, "inc-")) : options.stateDir, ""), () => {});
    await incidents.record({ portal: adapter.slug, step: "prueba_estructura", error: failure, captureStructure: () => adapter.captureStructure?.() ?? Promise.resolve(null) });
    const incident: Incident | undefined = (await incidents.list())[0];
    if (!incident?.reparable || !incident.structure) return { ...base, resultado: "sin_incidente", razon: "incidente no reparable o sin esquema" };

    // Memoria ANTES de consultar: lo que ya se verificó para este portal.
    const memoria = resumirMemoria(await store.list(), portalSlug);
    const verificadoPrevio = memoria.find((m) => m.clave === CLAVE)?.selectorVerificado;
    base.habiaMemoria = Boolean(verificadoPrevio);

    let retry: RetryInput | undefined;
    let lastSelector: string | undefined;
    for (let attempt = 1; attempt <= intentosMax; attempt++) {
      base.intentos = attempt;
      const { system, prompt } = buildPrompt({ incident, retry, memoria });
      base.consultas += 1;
      let answer: Awaited<ReturnType<typeof askModel>>;
      try {
        answer = await askModel(options.complete, { model: options.model, system, prompt });
      } catch (error) {
        return { ...base, resultado: "error", razon: oneLine(String(error instanceof Error ? error.message : error), 200) };
      }
      base.tokensEntrada += answer.tokensEntrada;
      base.tokensSalida += answer.tokensSalida;
      if (!answer.ok) return { ...base, resultado: "sin_propuesta", razon: answer.motivo };
      const valid = validateProposal(incident.portal, answer.respuesta);
      if (!valid.ok) return { ...base, resultado: "sin_propuesta", razon: valid.motivo };
      if (retry && valid.selector === lastSelector) return { ...base, resultado: "no_verificada", razon: "el modelo repitió el selector que ya falló" };
      lastSelector = valid.selector;
      base.selector = valid.selector;
      base.usoMemoria = Boolean(verificadoPrevio && valid.selector === verificadoPrevio);

      let trial: Awaited<ReturnType<typeof rehearseOnAdapter>>;
      try {
        trial = await rehearseOnAdapter(adapter, valid.clave, valid.selector, incident.step);
      } catch (error) {
        trial = { resultado: "fallo", mensaje: oneLine(String(error instanceof Error ? error.message : error), 300) };
      }
      if (trial.resultado === "fallo") {
        if (attempt === intentosMax) return { ...base, resultado: "no_verificada", razon: oneLine(trial.mensaje, 160) };
        retry = { attempt: attempt + 1, maxAttempts: intentosMax, clave: valid.clave, selector: valid.selector, mensaje: trial.mensaje, estructura: trial.estructura };
        continue;
      }

      // AUTO-APLICAR (solo entrenamiento) + VERIFICAR con la prueba de estructura.
      setOverride(portalSlug, valid.clave, { selector: valid.selector, aprobadoEn: now().toISOString(), incidenteId: idSeq });
      let verificada = false;
      try {
        await adapter.healthCheck();
        verificada = true;
      } catch {
        verificada = false;
      }
      const propuesta: Propuesta = {
        incidenteId: idSeq,
        portal: portalSlug,
        clave: valid.clave,
        selector: valid.selector,
        confianza: answer.respuesta.confianza,
        razon: oneLine(answer.respuesta.razon, 160),
        modelo: options.model,
        tokensEntrada: base.tokensEntrada,
        tokensSalida: base.tokensSalida,
        creadaEn: now().toISOString(),
        estado: "aplicada",
        probada: true,
        intentos: attempt,
        ensayo: { resultado: "paso", mensaje: oneLine(trial.mensaje, 160), en: now().toISOString() },
        aplicadaEn: now().toISOString(),
        ...(verificada ? { verificadaEn: now().toISOString() } : {}),
      };
      await store.save(propuesta);
      return { ...base, resultado: verificada ? "verificada" : "no_verificada", razon: verificada ? "ensayo y verificación pasaron" : "aplicada pero la verificación no pasó" };
    }
    return { ...base, resultado: "no_verificada", razon: "se agotaron los intentos" };
  } catch (error) {
    return { ...base, resultado: "error", razon: oneLine(String(error instanceof Error ? error.message : error), 200) };
  } finally {
    if (book && tituloOriginal) book[CLAVE] = tituloOriginal;
    await context?.close().catch(() => undefined);
    await portal.close().catch(() => undefined);
  }
}

export interface EntrenamientoReporte {
  fecha: string;
  modelo: string;
  maxConsultas: number;
  consultasUsadas: number;
  ciclos: CicloResultado[];
}

export async function entrenar(options: EntrenarOptions): Promise<EntrenamientoReporte> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  mkdirSync(options.stateDir, { recursive: true });
  configureSelectorState({ overridesFile: path.join(options.stateDir, "selectores.json"), tolerancesFile: path.join(options.stateDir, "tolerancias.json") });
  const store = new ProposalStore(path.join(options.stateDir, "propuestas"), now);

  const ciclos: CicloResultado[] = [];
  const browser = await chromium.launch({ headless: true });
  let consultas = 0;
  let idSeq = 1;
  let ciclo = 0;
  try {
    // Ronda a ronda, repartido entre portales, hasta agotar el presupuesto de consultas.
    while (consultas < options.maxConsultas) {
      let huboConsulta = false;
      for (const portalSlug of options.portales) {
        if (consultas >= options.maxConsultas) break;
        ciclo += 1;
        const r = await unCiclo(browser, portalSlug, ciclo, store, options, idSeq);
        idSeq += 1;
        consultas += r.consultas;
        if (r.consultas > 0) huboConsulta = true;
        ciclos.push(r);
        log(`[consultas ${consultas}/${options.maxConsultas}] ciclo ${ciclo} ${portalSlug}: ${r.resultado}${r.usoMemoria ? " (de memoria)" : r.habiaMemoria ? " (tenía memoria)" : ""} — ${r.razon}`);
      }
      if (!huboConsulta) {
        log("Ningún ciclo consultó al modelo en esta ronda: no hay más que aprender; se detiene.");
        break;
      }
    }
  } finally {
    await browser.close();
    resetSelectorState();
  }
  return { fecha: now().toISOString(), modelo: options.model, maxConsultas: options.maxConsultas, consultasUsadas: consultas, ciclos };
}

// ------------------------------------------------------------------------------------------------ informe

export function renderReporte(r: EntrenamientoReporte): string {
  const l: string[] = [];
  l.push("# Entrenamiento de la reparación asistida (portales FICTICIOS)", "");
  l.push("> Entrenamiento con auto-aprobación SOLO en entrenamiento. El robot de producción sigue necesitando el «sí N» de una persona. NO es una prueba contra portales reales.", "");
  l.push(`- Fecha: ${r.fecha}`);
  l.push(`- Modelo: ${r.modelo}`);
  l.push(`- Consultas al modelo: ${r.consultasUsadas} (tope ${r.maxConsultas})`);
  l.push(`- Ciclos: ${r.ciclos.length}`, "");

  const verificadas = r.ciclos.filter((c) => c.resultado === "verificada").length;
  const deMemoria = r.ciclos.filter((c) => c.usoMemoria).length;
  l.push("## Resumen", "");
  l.push(`- Reparaciones verificadas: ${verificadas}/${r.ciclos.length}.`);
  l.push(`- Propuestas «de memoria» (el modelo propuso el selector ya verificado antes): ${deMemoria}.`, "");

  l.push("## Ciclos", "");
  l.push("| Ciclo | Portal | Resultado | ¿Tenía memoria? | ¿Propuso de memoria? | Intentos | Tokens (ent/sal) | Selector |");
  l.push("|---|---|---|---|---|---|---|---|");
  for (const c of r.ciclos) {
    l.push(`| ${c.ciclo} | ${c.portal} | ${c.resultado} | ${c.habiaMemoria ? "sí" : "no"} | ${c.usoMemoria ? "sí" : "no"} | ${c.intentos} | ${c.tokensEntrada}/${c.tokensSalida} | ${c.selector ?? "—"} |`);
  }
  l.push("");

  l.push("## Por portal (orden cronológico: se ve si aprende)", "");
  for (const portal of [...new Set(r.ciclos.map((c) => c.portal))]) {
    const cs = r.ciclos.filter((c) => c.portal === portal);
    l.push(`- **${portal}**: ${cs.map((c) => `#${c.ciclo} ${c.resultado}${c.usoMemoria ? "·mem" : ""}`).join(", ")}`);
  }
  l.push("");
  return `${l.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------------ línea de comandos

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : def;
  };
  const maxConsultas = Number(get("--max-consultas", "100"));
  if (!Number.isInteger(maxConsultas) || maxConsultas < 1 || maxConsultas > 2_000) {
    console.error("--max-consultas debe ser un entero entre 1 y 2000.");
    return 1;
  }
  const portalArg = get("--portal");
  const portales = portalArg ? [portalArg as PortalSlug] : [...PORTAL_SLUGS];
  if (portalArg && !(PORTAL_SLUGS as readonly string[]).includes(portalArg)) {
    console.error(`--portal debe ser uno de: ${PORTAL_SLUGS.join(", ")}.`);
    return 1;
  }
  const salida = get("--salida", path.resolve("bot/.state/entrenamiento.md"))!;
  const stateDir = get("--state", path.resolve("bot/.state/entrenamiento"))!;

  let complete: Complete;
  let model: string;
  try {
    const config = loadRepairConfig(process.env);
    if (!config.repairEnabled) {
      console.error("Reparación desactivada: configure BOT_REPAIR_PROVIDER (p. ej. claude-cli) y BOT_REPAIR_MAX_PER_DAY>0 en el entorno.");
      return 1;
    }
    complete = createCompleteFromConfig(config, process.env);
    model = config.repairModel;
  } catch (error) {
    console.error(`Configuración inválida: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  console.log(`Entrenando con el modelo REAL (${model}) contra portales ficticios. Tope de consultas: ${maxConsultas}. Cada consulta cuenta contra el plan. Ctrl+C para cancelar; empieza en 5 s…`);
  await new Promise((r) => setTimeout(r, 5_000));

  const reporte = await entrenar({ complete, model, portales, maxConsultas, stateDir, log: (m) => console.log(m) });
  const mdPath = /\.md$/i.test(salida) ? salida : path.join(salida, "entrenamiento.md");
  mkdirSync(path.dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, renderReporte(reporte));
  writeFileSync(mdPath.replace(/\.md$/i, ".json"), `${JSON.stringify(reporte, null, 2)}\n`);
  const verificadas = reporte.ciclos.filter((c) => c.resultado === "verificada").length;
  const deMemoria = reporte.ciclos.filter((c) => c.usoMemoria).length;
  console.log(`Listo: ${reporte.ciclos.length} ciclos, ${verificadas} verificadas, ${deMemoria} «de memoria», ${reporte.consultasUsadas} consultas.`);
  console.log(`Informe: ${mdPath}`);
  return 0;
}

// Ejecutar solo si es el punto de entrada (no al importar en las pruebas).
if (process.argv[1] && /entrenar\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    (code) => (process.exitCode = code),
    (error: unknown) => {
      console.error(`El entrenamiento falló: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
