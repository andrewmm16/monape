import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "./errors";
import { findElement } from "./locate";

/**
 * LIBRO DE SELECTORES. Cada adaptador declara, por clave lógica (`campo_titulo`,
 * `boton_enviar`, `lista_postulantes`…), cómo encontrar ese elemento en SU portal:
 *
 *   selector por defecto (CSS)  +  alternativas tolerantes (rol, etiqueta, texto, CSS más laxo).
 *
 * Orden de resolución (`resolveElement`):
 *   1. override activo de `bot/.state/selectores.json` (aprobado por una persona),
 *   2. selector por defecto,
 *   3. alternativas, SOLO si la entrada no es `estricta`.
 *
 * POLÍTICA (qué se tolera y qué no)
 *   - TOLERANTES (con alternativas): pasos de LECTURA o de rellenado reversible: lista de
 *     postulantes, filas, enlace al CV, campos del formulario al rellenar, botones de
 *     navegación («Siguiente», «Atrás») y aviso de cookies. Si el portal cambia un nombre o
 *     un id pero el elemento sigue ahí con su etiqueta, el robot sigue y deja constancia
 *     (log + `bot/.state/tolerancias.json`) para corregir el adaptador sin prisa.
 *   - ESTRICTOS (solo selector exacto + override aprobado por una persona): el botón final de
 *     enviar/publicar y el botón de retirar, porque un clic equivocado publica o retira de
 *     verdad. También lo son las marcas que deciden el resultado (publicada / error, marca del
 *     paso del asistente, CAPTCHA, estado cerrado de la oferta): leerlas mal podría duplicar o
 *     perder una publicación. Si fallan, el error es `pagina_cambio`, como siempre.
 *
 * Los selectores NO deben contener datos personales (solo estructura: ids, clases, etiquetas).
 */

/** Rol ARIA para `getByRole`. */
export type RolAria = Parameters<Page["getByRole"]>[0];

/** Una forma alternativa (tolerante) de encontrar el elemento. Los textos son sinónimos, sin distinguir mayúsculas. */
export type Alternativa =
  | { etiqueta: string[] }
  | { rol: RolAria; nombre: string[] }
  | { texto: string[]; css?: string }
  | { css: string };

export interface EntradaLibro {
  descripcion: string;
  /** Sin alternativas automáticas: solo el selector exacto (o un override aprobado). */
  estricto: boolean;
  /** Selector CSS por defecto; `null` si el elemento no existe mientras el portal no cambia (p. ej. el aviso de cookies). */
  selector: string | null;
  alternativas: Alternativa[];
}

export type LibroSelectores = Record<string, EntradaLibro>;

export const tolerante = (descripcion: string, selector: string | null, alternativas: Alternativa[]): EntradaLibro => ({
  descripcion,
  estricto: false,
  selector,
  alternativas,
});

export const estricto = (descripcion: string, selector: string): EntradaLibro => ({ descripcion, estricto: true, selector, alternativas: [] });

/** Botón para aceptar un aviso de cookies que aparezca (no existe mientras el portal no lo muestre). */
export const AVISO_COOKIES: EntradaLibro = tolerante("Botón para aceptar el aviso de cookies", null, [
  {
    texto: ["Aceptar", "Accept", "Entendido", "Acepto"],
    css: "[class*='cookie' i] button, [id*='cookie' i] button, [class*='consent' i] button",
  },
]);

// ------------------------------------------------------------------ registro de libros

const libros = new Map<string, LibroSelectores>();

/** Cada adaptador registra su libro al cargarse (por el slug de su portal). */
export function registerBook(portal: string, libro: LibroSelectores): LibroSelectores {
  libros.set(portal, libro);
  return libro;
}

export const getBook = (portal: string): LibroSelectores | undefined => libros.get(portal);

// ------------------------------------------------------------------ validación de selectores

const SELECTOR_MAX = 200;

/** `null` si el selector es aceptable como override; si no, el motivo. */
export function validateSelector(selector: unknown): string | null {
  if (typeof selector !== "string" || selector.trim() === "") return "el selector está vacío";
  if (selector.length > SELECTOR_MAX) return `el selector supera ${SELECTOR_MAX} caracteres`;
  if (/[<{};\r\n\u0000-\u001f]/.test(selector)) return "el selector contiene caracteres no permitidos (< { } ; o saltos de línea)";
  if (/javascript:/i.test(selector)) return "el selector contiene «javascript:»";
  return null;
}

// ------------------------------------------------------------------ estado en disco

interface SelectorState {
  overridesFile: string;
  tolerancesFile: string;
  log: (message: string) => void;
  now: () => Date;
}

const defaultState = (): SelectorState => ({
  overridesFile: path.resolve(process.env.BOT_SELECTORS_FILE ?? "bot/.state/selectores.json"),
  tolerancesFile: path.resolve(process.env.BOT_TOLERANCES_FILE ?? "bot/.state/tolerancias.json"),
  log: () => {},
  now: () => new Date(),
});

let state: SelectorState = defaultState();
const loggedAt = new Map<string, number>();
let overridesCache: { key: string; data: OverridesFile } | null = null;

/** Cambia dónde se guardan los overrides y las tolerancias, y el log (el robot y las pruebas lo usan). */
export function configureSelectorState(patch: Partial<SelectorState>): void {
  state = { ...state, ...patch };
  overridesCache = null;
}

export function resetSelectorState(): void {
  state = defaultState();
  overridesCache = null;
  loggedAt.clear();
}

export const selectorFiles = () => ({ overridesFile: state.overridesFile, tolerancesFile: state.tolerancesFile });

/** Escritura atómica: quien lea el archivo ve el contenido anterior o el nuevo, nunca uno a medias. */
function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

// ---- overrides aprobados

export interface OverrideEntry {
  selector: string;
  aprobadoEn: string;
  incidenteId: number;
}

interface OverridesFile {
  version: 1;
  overrides: Record<string, Record<string, OverrideEntry>>;
}

const emptyOverrides = (): OverridesFile => ({ version: 1, overrides: {} });

/** Lectura tolerante: un archivo dañado, a medias o con entradas inválidas se ignora (nunca tumba al robot). */
function readOverrides(): OverridesFile {
  const file = state.overridesFile;
  let key: string;
  try {
    const info = statSync(file);
    key = `${file}:${info.mtimeMs}:${info.size}`;
  } catch {
    return emptyOverrides();
  }
  if (overridesCache?.key === key) return overridesCache.data;
  const data = emptyOverrides();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<OverridesFile>;
    for (const [portal, entries] of Object.entries(parsed.overrides ?? {})) {
      for (const [clave, entry] of Object.entries(entries ?? {})) {
        if (!entry || validateSelector(entry.selector) !== null) continue; // un override inválido no se aplica
        (data.overrides[portal] ??= {})[clave] = {
          selector: entry.selector,
          aprobadoEn: String(entry.aprobadoEn ?? ""),
          incidenteId: Number(entry.incidenteId) || 0,
        };
      }
    }
  } catch {
    return emptyOverrides();
  }
  overridesCache = { key, data };
  return data;
}

export const getOverride = (portal: string, clave: string): OverrideEntry | undefined => readOverrides().overrides[portal]?.[clave];

// ---- override «en ensayo»: solo en memoria, nunca se escribe en selectores.json

const trials = new Map<string, string>();

/**
 * Aplica un selector SOLO EN MEMORIA mientras corre `run` (la prueba de una propuesta antes de enviarla a la persona).
 * Se retira siempre al terminar, pase o falle `run`. Debe usarse en el turno del robot (sin ciclos en paralelo).
 */
export async function withTrialOverride<T>(portal: string, clave: string, selector: string, run: () => Promise<T>): Promise<T> {
  const problem = validateSelector(selector);
  if (problem) throw new Error(problem);
  const key = `${portal}/${clave}`;
  const previous = trials.get(key);
  trials.set(key, selector);
  try {
    return await run();
  } finally {
    if (previous === undefined) trials.delete(key);
    else trials.set(key, previous);
  }
}

/** Hay algún override en ensayo (pruebas). */
export const trialsActive = (): number => trials.size;

/** Guarda (o reemplaza) el override de una clave. Lanza si el selector no es válido o no se pudo escribir. */
export function setOverride(portal: string, clave: string, entry: OverrideEntry): void {
  const problem = validateSelector(entry.selector);
  if (problem) throw new Error(problem);
  const data = structuredClone(readOverrides());
  (data.overrides[portal] ??= {})[clave] = entry;
  overridesCache = null;
  writeJsonAtomic(state.overridesFile, data);
}

/** Quita el override de una clave. Con `incidenteId`, solo si fue el de ese incidente (no pisa uno posterior). */
export function removeOverride(portal: string, clave: string, incidenteId?: number): boolean {
  const data = structuredClone(readOverrides());
  const current = data.overrides[portal]?.[clave];
  if (!current || (incidenteId !== undefined && current.incidenteId !== incidenteId)) return false;
  delete data.overrides[portal]![clave];
  if (Object.keys(data.overrides[portal]!).length === 0) delete data.overrides[portal];
  overridesCache = null;
  writeJsonAtomic(state.overridesFile, data);
  return true;
}

// ---- eventos de tolerancia

export interface EventoTolerancia {
  timestamp: string;
  portal: string;
  clave: string;
  /** 0 = selector por defecto; 1… = alternativa usada (1 = la primera). */
  indiceUsado: number;
}

const MAX_TOLERANCE_EVENTS = 500;
const LOG_REPEAT_MS = 10 * 60_000;

/** Lectura tolerante del archivo de tolerancias (para el informe de entrenamiento). */
export function readTolerances(file: string = state.tolerancesFile): EventoTolerancia[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { eventos?: unknown }).eventos;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is EventoTolerancia =>
        !!e && typeof e.timestamp === "string" && typeof e.portal === "string" && typeof e.clave === "string" && typeof e.indiceUsado === "number",
    );
  } catch {
    return [];
  }
}

/** Anota que se usó algo distinto del selector por defecto. Nunca lanza. */
export function recordTolerance(portal: string, clave: string, indiceUsado: number, detalle = ""): void {
  try {
    const nowDate = state.now();
    const logKey = `${portal}:${clave}:${indiceUsado}`;
    const last = loggedAt.get(logKey);
    if (last === undefined || nowDate.getTime() - last >= LOG_REPEAT_MS) {
      loggedAt.set(logKey, nowDate.getTime());
      state.log(`Tolerancia en ${portal}: «${clave}» se encontró con la alternativa ${indiceUsado}${detalle ? ` (${detalle})` : ""}; el selector por defecto ya no sirve. Conviene corregir el adaptador.`);
    }
    const eventos = readTolerances();
    eventos.push({ timestamp: nowDate.toISOString(), portal, clave, indiceUsado });
    writeJsonAtomic(state.tolerancesFile, { version: 1, eventos: eventos.slice(-MAX_TOLERANCE_EVENTS) });
  } catch (error) {
    try {
      state.log(`No se pudo anotar la tolerancia de ${portal}/${clave}: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // nunca lanza
    }
  }
}

// ------------------------------------------------------------------ resolución

/** Lo que tienen en común una página y un elemento para buscar dentro. */
export type Raiz = Pick<Page, "locator" | "getByLabel" | "getByRole" | "getByText">;

export type Vars = Record<string, string | number>;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patron = (palabras: string[]) => new RegExp(palabras.map(escapeRegExp).join("|"), "i");
const withVars = (text: string, vars?: Vars) => (vars ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : text);

export function describirAlternativa(alt: Alternativa): string {
  if ("etiqueta" in alt) return `etiqueta ~ ${alt.etiqueta.join(" | ")}`;
  if ("rol" in alt) return `rol ${alt.rol} ~ ${alt.nombre.join(" | ")}`;
  if ("texto" in alt) return `texto ~ ${alt.texto.join(" | ")}${alt.css ? ` en ${alt.css}` : ""}`;
  return `css ${alt.css}`;
}

function construir(raiz: Raiz, alt: Alternativa, vars?: Vars): Locator {
  if ("etiqueta" in alt) return raiz.getByLabel(patron(alt.etiqueta));
  if ("rol" in alt) return raiz.getByRole(alt.rol, { name: patron(alt.nombre) });
  if ("texto" in alt) return alt.css ? raiz.locator(withVars(alt.css, vars)).filter({ hasText: patron(alt.texto) }) : raiz.getByText(patron(alt.texto));
  return raiz.locator(withVars(alt.css, vars));
}

interface Candidato {
  tipo: "override" | "defecto" | "alternativa";
  /** 0 = defecto; 1… = alternativa (el override no cuenta como alternativa). */
  indice: number;
  detalle: string;
  /** Solo si se expresa como CSS puro. */
  css?: string;
  build(raiz: Raiz): Locator;
}

function candidatos(portal: string, clave: string, vars?: Vars): { entrada: EntradaLibro; lista: Candidato[] } {
  const entrada = libros.get(portal)?.[clave];
  if (!entrada) throw new Error(`Clave de selector desconocida: ${portal}/${clave}`);
  const lista: Candidato[] = [];
  const trial = trials.get(`${portal}/${clave}`);
  if (trial) {
    lista.push({ tipo: "override", indice: 0, detalle: "override en ensayo", css: trial, build: (r) => r.locator(trial) });
  }
  const override = getOverride(portal, clave);
  if (override) {
    const css = withVars(override.selector, vars);
    lista.push({ tipo: "override", indice: 0, detalle: `override aprobado (incidente #${override.incidenteId})`, css, build: (r) => r.locator(css) });
  }
  if (entrada.selector !== null) {
    const css = withVars(entrada.selector, vars);
    lista.push({ tipo: "defecto", indice: 0, detalle: "selector por defecto", css, build: (r) => r.locator(css) });
  }
  if (!entrada.estricto) {
    entrada.alternativas.forEach((alt, i) => {
      const css = "css" in alt && !("texto" in alt) ? withVars(alt.css, vars) : undefined;
      lista.push({ tipo: "alternativa", indice: i + 1, detalle: describirAlternativa(alt), css, build: (r) => construir(r, alt, vars) });
    });
  }
  return { entrada, lista };
}

/** Selector CSS vigente (override, si no el de defecto) de una clave: para armar selectores combinados de las claves estrictas. */
export function activeSelector(portal: string, clave: string, vars?: Vars): string {
  const { entrada, lista } = candidatos(portal, clave, vars);
  const first = lista.find((c) => c.tipo !== "alternativa" && c.css);
  if (!first?.css) throw new Error(`La clave ${portal}/${clave} no tiene un selector CSS (${entrada.descripcion})`);
  return first.css;
}

const noted = (portal: string, clave: string, usado: Candidato | undefined) => {
  if (usado?.tipo === "alternativa") recordTolerance(portal, clave, usado.indice, usado.detalle);
};

export interface ResolveOptions {
  /** Dónde buscar (por defecto, la página recibida); p. ej. la fila de un postulante. */
  root?: Raiz;
  /** Tiempo máximo por cada forma de buscar. */
  timeoutMs?: number;
  /** «visible» (por defecto) o «attached» (basta con que exista). */
  state?: "visible" | "attached";
  /** Valores para los marcadores `{n}` de los selectores. */
  vars?: Vars;
  /** Para el mensaje de error: en qué pantalla se buscaba. */
  where?: string;
}

async function resolveCore(page: Raiz, portal: string, clave: string, options: ResolveOptions): Promise<{ locator: Locator; used: Candidato; raiz: Raiz }> {
  const raiz = options.root ?? page;
  const { entrada, lista } = candidatos(portal, clave, options.vars);
  const found: { used?: Candidato } = {};
  try {
    const locator = await findElement(raiz as Page, entrada.descripcion, lista.map((c) => () => c.build(raiz)), {
      timeoutMs: options.timeoutMs ?? 1_500,
      state: options.state ?? "visible",
      onFound: (_description, index) => {
        found.used = lista[index];
      },
    });
    noted(portal, clave, found.used);
    return { locator, used: found.used!, raiz };
  } catch (error) {
    if (error instanceof PortalError) {
      throw new PortalError(
        ERROR_CODES.pageChanged,
        `falta «${entrada.descripcion}» [${clave}]${options.where ? ` en ${options.where}` : ""} (se probaron ${lista.length} formas${entrada.estricto ? ", elemento estricto" : ""})`,
      );
    }
    throw error;
  }
}

/**
 * Encuentra el elemento de una clave del libro (override → defecto → alternativas si no es
 * estricto). Si se usó una alternativa, deja constancia (log + tolerancias.json). Si no lo
 * encuentra por ninguna vía lanza `pagina_cambio`.
 */
export async function resolveElement(page: Raiz, portal: string, clave: string, options: ResolveOptions = {}): Promise<Locator> {
  return (await resolveCore(page, portal, clave, options)).locator;
}

/** Como `resolveElement`, pero devuelve TODOS los elementos que cumplen la forma que funcionó (listas, filas, enlaces). */
export async function resolveAll(page: Raiz, portal: string, clave: string, options: ResolveOptions = {}): Promise<Locator> {
  const { used, raiz } = await resolveCore(page, portal, clave, options);
  return used.build(raiz);
}

/**
 * Busca SIN esperar (solo lo que ya está en la página): `null` si no hay nada. Sirve para
 * lo opcional (aviso de cookies, enlaces de una lista que puede estar vacía, botón de una oferta cerrada).
 */
export async function probeElement(page: Raiz, portal: string, clave: string, options: Pick<ResolveOptions, "vars"> & { all?: boolean } = {}): Promise<Locator | null> {
  const { lista } = candidatos(portal, clave, options.vars);
  for (const candidato of lista) {
    const all = candidato.build(page);
    const found = await all.count().catch(() => 0);
    if (found === 0) continue;
    noted(portal, clave, candidato);
    return options.all ? all : all.first();
  }
  return null;
}

/**
 * Para leer dentro de una página con `evaluate` (que solo recibe CSS): devuelve el selector CSS que
 * funciona dentro de `root` (override → defecto → alternativas CSS). Si ninguno encuentra nada,
 * devuelve el vigente (el mismo comportamiento de siempre: el campo queda vacío).
 */
export async function resolveCss(root: Raiz, portal: string, clave: string): Promise<string> {
  const { lista } = candidatos(portal, clave);
  const css = lista.filter((c) => c.css);
  for (const candidato of css) {
    if ((await root.locator(candidato.css!).count().catch(() => 0)) > 0) {
      noted(portal, clave, candidato);
      return candidato.css!;
    }
  }
  return css[0]?.css ?? "";
}

/** Descripción del libro de un portal (para el prompt de la reparación asistida): clave, descripción y selectores vigentes. */
export function describeBook(portal: string): { clave: string; descripcion: string; estricto: boolean; selector: string | null; alternativas: string[] }[] {
  const libro = libros.get(portal) ?? {};
  return Object.entries(libro).map(([clave, entrada]) => ({
    clave,
    descripcion: entrada.descripcion,
    estricto: entrada.estricto,
    selector: trials.get(`${portal}/${clave}`) ?? getOverride(portal, clave)?.selector ?? entrada.selector,
    alternativas: entrada.alternativas.map(describirAlternativa),
  }));
}
