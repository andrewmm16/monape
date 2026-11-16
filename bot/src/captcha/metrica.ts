import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Métrica de desafíos de verificación: registra cuántos y de qué tipo aparecen por portal y si
 * el robot los resolvió. Sirve para DECIDIR con datos qué solvers reales construir (Fase 4 de
 * `docs/escalado-captcha.md`) antes de invertir. Patrón de escritura atómica y lectura tolerante
 * igual que `tolerancias.json`. Sin datos personales. Nunca lanza (no debe tumbar un ciclo).
 */

export interface EventoDesafio {
  timestamp: string;
  portal: string;
  /** Etiqueta del tipo de desafío (p. ej. «slider», «casilla…»). */
  tipo: string;
  resuelto: boolean;
  intentos: number;
}

const MAX_EVENTOS = 1000;

export function desafiosFile(): string {
  return path.resolve(process.env.BOT_DESAFIOS_FILE ?? "bot/.state/desafios.json");
}

/** Lectura tolerante: un archivo dañado o a medias se ignora. */
export function readDesafios(file: string = desafiosFile()): EventoDesafio[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { eventos?: unknown }).eventos;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e): e is EventoDesafio =>
        !!e &&
        typeof e.timestamp === "string" &&
        typeof e.portal === "string" &&
        typeof e.tipo === "string" &&
        typeof e.resuelto === "boolean" &&
        typeof e.intentos === "number",
    );
  } catch {
    return [];
  }
}

function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Anota la aparición de un desafío y si el robot lo resolvió. Nunca lanza. */
export function registrarDesafio(evento: Omit<EventoDesafio, "timestamp">, file: string = desafiosFile()): void {
  try {
    const eventos = readDesafios(file);
    eventos.push({ timestamp: new Date().toISOString(), ...evento });
    writeJsonAtomic(file, { version: 1, eventos: eventos.slice(-MAX_EVENTOS) });
  } catch {
    // la métrica nunca debe tumbar un ciclo del robot
  }
}

export interface ConteoDesafios {
  total: number;
  resueltos: number;
}
export interface ResumenDesafios extends ConteoDesafios {
  porPortal: Record<string, ConteoDesafios>;
  porTipo: Record<string, ConteoDesafios>;
}

/** Resume los eventos por portal y por tipo (para el informe). Función pura. */
export function resumirDesafios(eventos: EventoDesafio[]): ResumenDesafios {
  const resumen: ResumenDesafios = { total: 0, resueltos: 0, porPortal: {}, porTipo: {} };
  const suma = (mapa: Record<string, ConteoDesafios>, clave: string, resuelto: boolean) => {
    const c = (mapa[clave] ??= { total: 0, resueltos: 0 });
    c.total++;
    if (resuelto) c.resueltos++;
  };
  for (const e of eventos) {
    resumen.total++;
    if (e.resuelto) resumen.resueltos++;
    suma(resumen.porPortal, e.portal, e.resuelto);
    suma(resumen.porTipo, e.tipo, e.resuelto);
  }
  return resumen;
}
