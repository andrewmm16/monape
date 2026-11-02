import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PORTAL_SLUGS, type PortalSlug } from "./model";
import { getMutacion, mutacionesDe, type Mutacion, type PasoRobot, type TipoMutacion } from "./mutations";
import { SITES, type Site } from "./sites";
import { atribuir, finDe } from "../training-report";
import { cloneVariant, mergeVariant, resolveSite, type Variant } from "./variants";

/**
 * El MUTADOR de los portales ficticios: cambia la estructura de UN portal por vez
 * para ver si el robot lo detecta, cuánto tarda y si da falsas alarmas. Guarda el
 * ORIGINAL (baseline) de cada portal para restablecerlo, y un diario de cambios.
 * No toca el robot ni ningún portal real.
 */
export type EstadoCambio = "activa" | "resuelta" | "restablecida";

/** Un cambio aplicado a un portal (una línea del diario). */
export interface Cambio {
  id: number;
  timestamp: string;
  portal: PortalSlug;
  mutacion: string;
  tipo: TipoMutacion;
  descripcion: string;
  esperado: PasoRobot[];
  estado: EstadoCambio;
  resueltaEn?: string;
  /** `automatico` = lo aplicó el programador; `manual` = el endpoint `/__fake/mutaciones/aplicar`. */
  origen: "automatico" | "manual";
  /** Modo continuo: el mutador lo restableció solo (estado `restablecida`). */
  restablecida_auto?: boolean;
  /** Por qué se restableció solo: el robot lo detectó (más el margen de gracia) o venció el máximo de vida. */
  motivo?: "detectado" | "tiempo";
  restablecidaEn?: string;
}

/** Un turno del programador en que no se aplicó lo previsto (o se cambió por un cosmético). */
export interface Omision {
  timestamp: string;
  portal: PortalSlug;
  motivo: string;
}

interface Diario {
  version: 1;
  cambios: Cambio[];
  omitidos: Omision[];
}

/** Un incidente del robot, lo mínimo que el mutador necesita para saber si ya notó un cambio. */
export interface IncidenteVisto {
  portal: string;
  createdAt: string;
  lastSeenAt: string;
}

/** Modo continuo: un estructural activo se restablece solo al ser detectado (tras un margen) o al vencer su vida máxima. */
export interface AutoRestoreOptions {
  /** Margen entre que el robot detecta el cambio y se restablece el portal (por defecto 3 min). */
  graceMs?: number;
  /** Vida máxima de un estructural sin detección (por defecto 60 min). */
  maxLifeMs?: number;
  /** Cada cuánto se revisa (por defecto 15 s). */
  sweepMs?: number;
}

export const DEFAULT_GRACE_MS = 3 * 60_000;
export const DEFAULT_MAX_LIFE_MS = 60 * 60_000;
const DEFAULT_SWEEP_MS = 15_000;

export interface MutatorOptions {
  /** Cada cuántos milisegundos cambia un portal; sin él no hay temporizador (solo cambios manuales). */
  intervalMs?: number;
  /** Semilla de la elección de mutaciones; sin ella se toma una de la hora y queda en el estado. */
  seed?: number;
  /** Diario en disco; sin él, el diario vive solo en memoria. */
  diaryFile?: string;
  /** Sin esto el comportamiento es el anterior: un estructural dura hasta que alguien lo resuelve o restablece. */
  autoRestore?: AutoRestoreOptions;
  /** Incidentes del robot (se lee en cada revisión); sin él, solo vale el máximo de vida. */
  incidents?: () => IncidenteVisto[];
  now?: () => number;
  log?: (message: string) => void;
}

export interface MutatorState {
  activo: boolean;
  cadaMinutos: number | null;
  semilla: number;
  proximoCambio: string | null;
  tope: number;
  /** Modo continuo (minutos de margen y de vida máxima); `null` = apagado. */
  restablecimientoAuto: { graciaMin: number; vidaMaxMin: number } | null;
  turnos: number;
  activas: Cambio[];
  cambios: Cambio[];
  omitidos: Omision[];
}

export interface Mutator {
  /** El sitio con su variante vigente (el original si no hay cambios). */
  siteOf(slug: PortalSlug): Site;
  /** Un turno del programador: un portal, el siguiente de la rotación. */
  tick(): { cambio?: Cambio; omision?: Omision };
  /** Fuerza una mutación (pruebas y demostración); no respeta el tope. Lanza `Error` si no aplica. */
  apply(portal: PortalSlug, mutacion: string): Cambio;
  /** Revisa los estructurales automáticos activos y restablece los que toca (solo con el modo continuo). Devuelve los restablecidos. */
  sweep(): Cambio[];
  /** Acepta el estado actual del portal como nuevo original (el adaptador ya se corrigió). */
  resolve(portal: PortalSlug): Cambio[];
  /** Vuelve al original. Sin portal, en los cinco. */
  restore(portal?: PortalSlug): Cambio[];
  state(): MutatorState;
  readonly running: boolean;
  start(): void;
  stop(): void;
}

/** Máximo de portales con un cambio estructural sin resolver. */
export const MAX_STRUCTURAL = 2;
/** De cada 3 turnos, 1 es cosmético y 2 son estructurales. */
const COSMETIC_EVERY = 3;
const MAX_OMITIDOS = 200;

/** Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma secuencia. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMutator(options: MutatorOptions = {}): Mutator {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const seed = options.seed ?? Math.floor(now() % 2_147_483_647);
  const random = rng(seed);
  const iso = () => new Date(now()).toISOString();

  const baseline = Object.fromEntries(PORTAL_SLUGS.map((slug) => [slug, {} as Variant])) as Record<PortalSlug, Variant>;
  const current = Object.fromEntries(PORTAL_SLUGS.map((slug) => [slug, {} as Variant])) as Record<PortalSlug, Variant>;
  // Bolsa de mutaciones por portal y tipo: se recorre entera (barajada con la semilla) antes de repetir una.
  const bags = new Map<string, string[]>();
  const lastPicked = new Map<string, string>();
  const detectedAt = new Map<number, number>();
  const auto = options.autoRestore
    ? {
        graceMs: options.autoRestore.graceMs ?? DEFAULT_GRACE_MS,
        maxLifeMs: options.autoRestore.maxLifeMs ?? DEFAULT_MAX_LIFE_MS,
        sweepMs: options.autoRestore.sweepMs ?? DEFAULT_SWEEP_MS,
      }
    : null;
  let turns = 0;
  let nextAt: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  let sweepTimer: NodeJS.Timeout | undefined;

  const diary: Diario = { version: 1, cambios: [], omitidos: [] };

  function save(): void {
    if (!options.diaryFile) return;
    try {
      mkdirSync(path.dirname(options.diaryFile), { recursive: true });
      const tmp = `${options.diaryFile}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(diary, null, 2)}\n`);
      renameSync(tmp, options.diaryFile);
    } catch (error) {
      log(`No se pudo guardar el diario de mutaciones: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Un servidor nuevo arranca con los portales originales: lo que quedó «activo» de antes ya no está vigente.
  if (options.diaryFile) {
    try {
      const previous = JSON.parse(readFileSync(options.diaryFile, "utf8")) as Partial<Diario>;
      diary.cambios = Array.isArray(previous.cambios) ? previous.cambios : [];
      diary.omitidos = Array.isArray(previous.omitidos) ? previous.omitidos : [];
      let reset = 0;
      for (const cambio of diary.cambios) {
        if (cambio.estado === "activa") {
          cambio.estado = "restablecida";
          cambio.resueltaEn = iso();
          reset++;
        }
      }
      if (reset > 0) {
        log(`Diario de mutaciones: ${reset} cambio(s) activo(s) de la sesión anterior pasan a «restablecida» (el servidor arrancó con los originales).`);
        save();
      }
    } catch {
      // Sin diario previo (o dañado): se empieza uno nuevo.
    }
  }

  const active = (portal?: PortalSlug) => diary.cambios.filter((c) => c.estado === "activa" && (!portal || c.portal === portal));
  const activeStructuralPortals = () => new Set(active().filter((c) => c.tipo === "estructural").map((c) => c.portal));

  function close(cambios: Cambio[], estado: "resuelta" | "restablecida"): Cambio[] {
    for (const cambio of cambios) {
      cambio.estado = estado;
      cambio.resueltaEn = iso();
    }
    if (cambios.length > 0) save();
    return cambios;
  }

  function apply(portal: PortalSlug, mutacionId: string, origen: Cambio["origen"] = "manual"): Cambio {
    if (!PORTAL_SLUGS.includes(portal)) throw new Error(`portal desconocido: ${portal}`);
    const mutacion = getMutacion(mutacionId);
    if (!mutacion) throw new Error(`mutación desconocida: ${mutacionId}`);
    if (!mutacion.portales.includes(portal)) throw new Error(`la mutación ${mutacionId} no aplica a ${portal}`);
    // Un cosmético reemplaza al cosmético anterior del mismo portal.
    if (mutacion.tipo === "cosmetica") close(active(portal).filter((c) => c.tipo === "cosmetica"), "resuelta");
    current[portal] = mergeVariant(current[portal], mutacion.variante(portal));
    const cambio: Cambio = {
      id: Math.max(0, ...diary.cambios.map((c) => c.id)) + 1,
      timestamp: iso(),
      portal,
      mutacion: mutacion.id,
      tipo: mutacion.tipo,
      descripcion: mutacion.descripcion,
      esperado: mutacion.esperado(portal),
      estado: "activa",
      origen,
    };
    diary.cambios.push(cambio);
    save();
    log(`Mutación ${mutacion.id} (${mutacion.tipo}) aplicada a ${portal}.`);
    return cambio;
  }

  function omit(portal: PortalSlug, motivo: string): Omision {
    const omision: Omision = { timestamp: iso(), portal, motivo };
    diary.omitidos.push(omision);
    if (diary.omitidos.length > MAX_OMITIDOS) diary.omitidos.splice(0, diary.omitidos.length - MAX_OMITIDOS);
    save();
    log(`Mutador: ${portal} sin cambio estructural (${motivo}).`);
    return omision;
  }

  /** Siguiente mutación del portal y tipo: la bolsa se rellena barajada solo al agotarse (sin repetir la última de la vuelta anterior). */
  function nextMutation(portal: PortalSlug, tipo: TipoMutacion): Mutacion {
    const key = `${portal}:${tipo}`;
    let bag = bags.get(key) ?? [];
    if (bag.length === 0) {
      bag = mutacionesDe(portal, tipo).map((m) => m.id);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      // Se saca por el final: si coincide con la última aplicada, se cambia de lugar.
      if (bag.length > 1 && bag[bag.length - 1] === lastPicked.get(key)) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1]!, bag[0]!];
    }
    const id = bag.pop()!;
    bags.set(key, bag);
    lastPicked.set(key, id);
    return getMutacion(id)!;
  }

  const cosmeticFor = (portal: PortalSlug): Cambio => apply(portal, nextMutation(portal, "cosmetica").id, "automatico");

  /** Devuelve el portal a su original y vuelve a poner los demás cambios que siguen activos en él. */
  function restoreAuto(cambio: Cambio, motivo: "detectado" | "tiempo"): void {
    const portal = cambio.portal;
    cambio.estado = "restablecida";
    cambio.resueltaEn = cambio.restablecidaEn = iso();
    cambio.restablecida_auto = true;
    cambio.motivo = motivo;
    current[portal] = cloneVariant(baseline[portal]);
    for (const other of active(portal)) current[portal] = mergeVariant(current[portal], getMutacion(other.mutacion)!.variante(portal));
    detectedAt.delete(cambio.id);
    save();
    log(`Mutador: ${portal} restablecido solo (${cambio.mutacion}, ${motivo === "detectado" ? "el robot lo detectó" : "venció el tiempo máximo sin detección"}).`);
  }

  function sweep(): Cambio[] {
    if (!auto) return [];
    const restored: Cambio[] = [];
    const nowMs = now();
    let incidents: IncidenteVisto[] | null = null;
    // Solo los cambios del programador: los forzados a mano (demo, pruebas) se quedan hasta que alguien los quite.
    for (const cambio of active().filter((c) => c.tipo === "estructural" && c.origen === "automatico")) {
      if (!detectedAt.has(cambio.id)) {
        try {
          incidents ??= options.incidents?.() ?? [];
        } catch {
          incidents = [];
        }
        const hit = atribuir(cambio, finDe(cambio, diary.cambios), incidents);
        if (hit) detectedAt.set(cambio.id, hit.at);
      }
      const seenAt = detectedAt.get(cambio.id);
      if (seenAt !== undefined && nowMs - seenAt >= auto.graceMs) restoreAuto(cambio, "detectado");
      else if (nowMs - Date.parse(cambio.timestamp) >= auto.maxLifeMs) restoreAuto(cambio, "tiempo");
      else continue;
      restored.push(cambio);
    }
    return restored;
  }

  function tick(): { cambio?: Cambio; omision?: Omision } {
    sweep();
    const portal = PORTAL_SLUGS[turns % PORTAL_SLUGS.length]!;
    turns++;
    const wantsCosmetic = turns % COSMETIC_EVERY === 0;

    if (active(portal).some((c) => c.tipo === "estructural")) {
      return { omision: omit(portal, "el portal ya tiene un cambio estructural sin resolver") };
    }
    if (wantsCosmetic) return { cambio: cosmeticFor(portal) };
    if (activeStructuralPortals().size >= MAX_STRUCTURAL) {
      const omision = omit(portal, `ya hay ${MAX_STRUCTURAL} portales con un cambio estructural sin resolver: se aplica un cambio cosmético`);
      return { omision, cambio: cosmeticFor(portal) };
    }
    return { cambio: apply(portal, nextMutation(portal, "estructural").id, "automatico") };
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    if (sweepTimer) clearInterval(sweepTimer);
    timer = sweepTimer = undefined;
    nextAt = null;
  }

  function start(): void {
    if (auto && !sweepTimer) {
      sweepTimer = setInterval(() => {
        try {
          sweep();
        } catch (error) {
          log(`Mutador: falló la revisión de restablecimiento: ${error instanceof Error ? error.message : String(error)}`);
        }
      }, auto.sweepMs);
      sweepTimer.unref();
    }
    const interval = options.intervalMs;
    if (!interval || interval <= 0 || timer) return;
    nextAt = now() + interval;
    timer = setInterval(() => {
      nextAt = now() + interval;
      try {
        tick();
      } catch (error) {
        log(`Mutador: falló un turno: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, interval);
    timer.unref();
  }

  return {
    siteOf: (slug) => resolveSite(SITES[slug], current[slug]),
    tick,
    sweep,
    apply: (portal, mutacion) => apply(portal, mutacion, "manual"),
    resolve(portal) {
      baseline[portal] = cloneVariant(current[portal]);
      return close(active(portal), "resuelta");
    },
    restore(portal) {
      const portals = portal ? [portal] : [...PORTAL_SLUGS];
      for (const slug of portals) current[slug] = cloneVariant(baseline[slug]);
      return close(
        portals.flatMap((slug) => active(slug)),
        "restablecida",
      );
    },
    state: () => ({
      activo: timer !== undefined,
      cadaMinutos: options.intervalMs ? options.intervalMs / 60_000 : null,
      semilla: seed,
      proximoCambio: nextAt === null ? null : new Date(nextAt).toISOString(),
      tope: MAX_STRUCTURAL,
      restablecimientoAuto: auto ? { graciaMin: auto.graceMs / 60_000, vidaMaxMin: auto.maxLifeMs / 60_000 } : null,
      turnos: turns,
      activas: active().map((c) => ({ ...c })),
      cambios: diary.cambios.map((c) => ({ ...c })),
      omitidos: diary.omitidos.map((o) => ({ ...o })),
    }),
    get running() {
      return timer !== undefined;
    },
    start,
    stop,
  };
}
