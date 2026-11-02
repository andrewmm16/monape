import type { BrowserContext } from "@playwright/test";
import { openSession } from "../browser";
import type { BotConfig } from "../config";
import type { PortalAdapter } from "../types";
import { FakePortalAdapter } from "./fake";
import { FakeBumeranAdapter } from "./fake-bumeran";
import { FakeComputrabajoAdapter } from "./fake-computrabajo";
import { FakeIndeedAdapter } from "./fake-indeed";
import { FakeLinkedinAdapter } from "./fake-linkedin";
import { FakeTrabajosDiariosAdapter } from "./fake-trabajos-diarios";

export interface AdapterEntry {
  /** Dirección donde una persona inicia sesión a mano. */
  loginUrl(config: BotConfig): string;
  /** Crea el adaptador sobre un navegador ya abierto (varios adaptadores pueden compartirlo, cada uno con su pestaña). */
  build(config: BotConfig, context: BrowserContext): PortalAdapter;
  /** Abre su propio navegador y crea el adaptador. */
  create(config: BotConfig): Promise<PortalAdapter>;
}

function entry(loginPath: string, build: AdapterEntry["build"]): AdapterEntry {
  return {
    loginUrl: (config) => `${config.fakePortalUrl}${loginPath}`,
    build,
    create: async (config) => build(config, await openSession(config.profileDir, config.headless, config.slowMoMs)),
  };
}

/**
 * Adaptadores disponibles. Aquí se registrará el de cada portal real cuando se
 * escriba con capturas de la cuenta de empresa (nunca con selectores inventados).
 * Los `fake-*` son los cinco portales FICTICIOS de la demostración.
 */
export const ADAPTERS: Record<string, AdapterEntry> = {
  // Portal falso original (rutas de la raíz); se conserva por compatibilidad.
  fake: entry("/login", (config, context) => new FakePortalAdapter(context, config.fakePortalUrl)),
  "fake-linkedin": entry("/linkedin/login", (config, context) => new FakeLinkedinAdapter(context, config.fakePortalUrl)),
  "fake-bumeran": entry("/bumeran/login", (config, context) => new FakeBumeranAdapter(context, config.fakePortalUrl)),
  "fake-trabajos-diarios": entry("/trabajos-diarios/login", (config, context) => new FakeTrabajosDiariosAdapter(context, config.fakePortalUrl)),
  "fake-indeed": entry("/indeed/login", (config, context) => new FakeIndeedAdapter(context, config.fakePortalUrl)),
  "fake-computrabajo": entry("/computrabajo/login", (config, context) => new FakeComputrabajoAdapter(context, config.fakePortalUrl)),
};

/** Alias de `BOT_ADAPTER`: `demo` = los cinco portales ficticios. */
export const ALIASES: Record<string, string[]> = {
  demo: ["fake-linkedin", "fake-bumeran", "fake-trabajos-diarios", "fake-indeed", "fake-computrabajo"],
};

export function getAdapter(name: string): AdapterEntry {
  const entry = ADAPTERS[name];
  if (!entry) {
    throw new Error(
      `BOT_ADAPTER "${name}" no existe. Disponibles: ${[...Object.keys(ADAPTERS), ...Object.keys(ALIASES)].join(", ")}.`,
    );
  }
  return entry;
}

/** `BOT_ADAPTER` puede ser un nombre, una lista separada por comas o un alias (`demo`). Sin repetidos y en orden. */
export function parseAdapterNames(value: string): string[] {
  const names: string[] = [];
  for (const raw of value.split(",")) {
    const name = raw.trim();
    if (!name && value.includes(",")) continue;
    for (const expanded of ALIASES[name] ?? [name]) {
      getAdapter(expanded); // lanza si no existe
      if (!names.includes(expanded)) names.push(expanded);
    }
  }
  if (names.length === 0) getAdapter(""); // lanza el mismo error de siempre
  return names;
}

export interface AdapterSet {
  names: string[];
  adapters: PortalAdapter[];
  /** Cierra el navegador compartido (una sola vez). */
  close(): Promise<void>;
}

/** Abre UN navegador y crea en él un adaptador por cada nombre (cada uno usa su propia pestaña). */
export async function createAdapters(config: BotConfig): Promise<AdapterSet> {
  const names = parseAdapterNames(config.adapter);
  const context = await openSession(config.profileDir, config.headless, config.slowMoMs);
  try {
    const adapters = names.map((name) => getAdapter(name).build(config, context));
    const slugs = adapters.map((adapter) => adapter.slug);
    if (new Set(slugs).size !== slugs.length) {
      throw new Error(`BOT_ADAPTER repite un mismo portal (${slugs.join(", ")}): use solo uno por portal.`);
    }
    return { names, adapters, close: () => context.close() };
  } catch (error) {
    await context.close();
    throw error;
  }
}
