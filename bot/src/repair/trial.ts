import { sanitizeText, type IncidentStep } from "../incidents";
import { withTrialOverride } from "../selectors";
import type { PortalAdapter } from "../types";

/**
 * ENSAYO de una propuesta antes de enviarla a la persona: se aplica el selector SOLO EN MEMORIA
 * (override «en ensayo», nunca se escribe en selectores.json) y se ejecuta el `healthCheck()` del
 * adaptador, que no envía, publica ni retira nada. El override se retira siempre (try/finally).
 * El ensayo usa el navegador compartido, así que NUNCA corre en paralelo con un ciclo: se encola
 * (`TrialQueue`) y el robot lo ejecuta en su propio turno, junto a las comprobaciones de reanudación.
 */
export interface EnsayoResult {
  resultado: "paso" | "fallo" | "no_cubierto";
  /** Mensaje saneado (error del ensayo, o nota si no se pudo probar). */
  mensaje: string;
  /** Esquema fresco de la pantalla donde falló (saneado), si el adaptador lo da. */
  estructura?: string;
}

/** Prueba un selector para una clave de un portal; la implementación real pasa por la cola del robot. */
export type Rehearse = (portal: string, clave: string, selector: string, step: IncidentStep) => Promise<EnsayoResult>;

/**
 * ¿La prueba de estructura recorre el paso que falló? Lo que no pudo verificar (no hay ofertas o
 * postulantes en el portal) viene en `healthCheckGaps()`: leer postulantes, bajar el CV y retirar
 * solo se prueban si hay datos.
 */
export function stepCovered(step: IncidentStep, gaps: string[]): boolean {
  if (step === "leer_postulantes") return !gaps.some((g) => g.startsWith("lista de candidatos"));
  if (step === "descargar_cv") return !gaps.some((g) => g.startsWith("enlace al CV"));
  if (step === "retirar") return !gaps.some((g) => g.startsWith("botón de retirar"));
  return true; // publicar y la propia prueba de estructura
}

/** Ensayo sobre un adaptador (llamar solo desde el turno del robot). */
export async function rehearseOnAdapter(adapter: PortalAdapter, clave: string, selector: string, step: IncidentStep): Promise<EnsayoResult> {
  try {
    await withTrialOverride(adapter.slug, clave, selector, () => adapter.healthCheck());
  } catch (error) {
    let estructura: string | undefined;
    try {
      estructura = (await adapter.captureStructure?.()) ?? undefined;
    } catch {
      // sin esquema fresco
    }
    return { resultado: "fallo", mensaje: sanitizeText(error instanceof Error ? error.message : String(error), 300), estructura };
  }
  const gaps = adapter.healthCheckGaps?.() ?? [];
  return stepCovered(step, gaps)
    ? { resultado: "paso", mensaje: "la prueba de estructura pasó con el selector en ensayo" }
    : { resultado: "no_cubierto", mensaje: `la prueba de estructura pasó, pero no cubre este paso (${gaps.join(", ")})` };
}

interface Job {
  run: () => Promise<EnsayoResult>;
  resolve: (result: EnsayoResult) => void;
}

/** Cola de ensayos: `enqueue` no ejecuta nada; el robot llama a `drain()` en su turno (sin ciclos en paralelo). */
export class TrialQueue {
  private jobs: Job[] = [];

  get pending(): number {
    return this.jobs.length;
  }

  enqueue(run: () => Promise<EnsayoResult>): Promise<EnsayoResult> {
    return new Promise((resolve) => this.jobs.push({ run, resolve }));
  }

  /** Ejecuta los ensayos pendientes de uno en uno. Un ensayo que lanza cuenta como fallo; nunca lanza. */
  async drain(): Promise<number> {
    let done = 0;
    for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
      try {
        job.resolve(await job.run());
      } catch (error) {
        job.resolve({ resultado: "fallo", mensaje: sanitizeText(error instanceof Error ? error.message : String(error), 300) });
      }
      done++;
    }
    return done;
  }
}
