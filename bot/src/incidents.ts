import { readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { errorCodeOf, NOT_REPAIRABLE } from "./errors";

/** Dónde falló el robot. */
export type IncidentStep = "publicar" | "retirar" | "leer_postulantes" | "descargar_cv" | "prueba_estructura";

export type IncidentStatus = "abierto" | "aprobado" | "rechazado";

export interface Incident {
  /** Número corto, para responder por mensajería («sí 3»). */
  id: number;
  createdAt: string;
  lastSeenAt: string;
  /** Veces que se repitió el mismo fallo (mismo portal, paso y código) mientras seguía abierto. */
  occurrences: number;
  portal: string;
  step: IncidentStep;
  errorCode: string;
  /** Mensaje del error sin correos, teléfonos ni parámetros de enlaces; recortado. */
  message: string;
  /** Una persona (sesión, CAPTCHA) lo resuelve; no hay nada que reparar en el adaptador. */
  reparable: boolean;
  publicationId?: string;
  /** Esquema de la pantalla (campos y botones, sin valores ni textos de contenido); `null` si el adaptador no lo da. */
  structure: string | null;
  status: IncidentStatus;
  decidedAt?: string;
  /** El robot reanudó solo el portal (la prueba de estructura volvió a pasar). No cambia el estado ni la decisión de la persona. */
  recoveredAt?: string;
  recoveryNote?: string;
}

/** Lectura síncrona de la carpeta de incidentes (para el servidor de portales ficticios, que no es asíncrono). Ignora archivos dañados. */
export function listIncidentsSync(dir: string): Incident[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const incidents: Incident[] = [];
  for (const name of names.filter((n) => /^\d{4,}\.json$/.test(n)).sort()) {
    try {
      incidents.push(JSON.parse(readFileSync(path.join(dir, name), "utf8")) as Incident);
    } catch {
      // Archivo dañado o a medio escribir: se ignora.
    }
  }
  return incidents;
}

export interface IncidentInput {
  portal: string;
  step: IncidentStep;
  error: unknown;
  publicationId?: string;
  /** Se llama una sola vez, solo si el incidente es nuevo; puede fallar sin afectar al robot. */
  captureStructure?: () => Promise<string | null | undefined>;
}

/** Lo único que el runner necesita: registrar sin lanzar nunca. */
export interface IncidentRecorder {
  record(input: IncidentInput): Promise<void>;
  /** Anota que el robot reanudó el portal: marca los incidentes abiertos de la prueba de estructura de ese portal. Devuelve cuántos. */
  recover?(portal: string, note: string): Promise<number>;
}

const MESSAGE_MAX = 600;
const STRUCTURE_MAX = 20_000;
/** El mismo fallo dentro de esta ventana cuenta como repetición, no como incidente nuevo. */
const REPEAT_WINDOW_MS = 6 * 3_600_000;
const CAPTURE_TIMEOUT_MS = 10_000;

/** Quita datos personales probables de un texto de error y lo recorta. */
export function sanitizeText(text: string, max = MESSAGE_MAX): string {
  const clean = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/https?:\/\/[^\s)'"<>]+/g, (url) => url.split(/[?#]/)[0])
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (match) => (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(match) ? match : "[número]"))
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("tiempo agotado")), ms)))]);
  } finally {
    clearTimeout(timer);
  }
};

/** Incidentes en archivos JSON (uno por incidente) dentro de una carpeta local ignorada por git. */
export class FileIncidentStore implements IncidentRecorder {
  constructor(
    private readonly dir: string,
    private readonly log: (message: string) => void,
    /** Aviso al responsable cuando aparece un incidente nuevo. */
    private readonly onNew?: (incident: Incident) => Promise<void> | void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private file(id: number): string {
    return path.join(this.dir, `${String(id).padStart(4, "0")}.json`);
  }

  async list(): Promise<Incident[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const incidents: Incident[] = [];
    for (const name of names.filter((n) => /^\d{4,}\.json$/.test(n)).sort()) {
      try {
        incidents.push(JSON.parse(await readFile(path.join(this.dir, name), "utf8")) as Incident);
      } catch {
        // Archivo dañado: se ignora, no debe tumbar al robot.
      }
    }
    return incidents;
  }

  async get(id: number): Promise<Incident | null> {
    return (await this.list()).find((incident) => incident.id === id) ?? null;
  }

  /** Escritura atómica: un corte a mitad de camino no deja un JSON a medias (que se perdería y repetiría su número). */
  private async save(incident: Incident): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.file(incident.id);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, `${JSON.stringify(incident, null, 2)}\n`);
    await rename(tmp, target);
  }

  /** Las operaciones sobre los archivos van de una en una: dos a la vez podrían repetir un número o pisarse. */
  private chain: Promise<unknown> = Promise.resolve();
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation, operation);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Marca la decisión de la persona. Devuelve el motivo si no existe o ya estaba decidido. */
  decide(id: number, decision: "aprobado" | "rechazado"): Promise<Incident | "no_existe" | "ya_decidido"> {
    return this.exclusive(async () => {
      const incident = await this.get(id);
      if (!incident) return "no_existe";
      if (incident.status !== "abierto") return "ya_decidido";
      const updated: Incident = { ...incident, status: decision, decidedAt: this.now().toISOString() };
      await this.save(updated);
      return updated;
    });
  }

  /**
   * Nota de recuperación: el incidente sigue «abierto» (la decisión es de la persona),
   * pero ya no absorbe repeticiones: un fallo posterior del mismo paso es un incidente nuevo.
   */
  recover(portal: string, note: string): Promise<number> {
    return this.exclusive(async () => {
      const recoveredAt = this.now().toISOString();
      let marked = 0;
      for (const incident of await this.list()) {
        if (incident.portal !== portal || incident.status !== "abierto" || incident.step !== "prueba_estructura" || incident.recoveredAt) continue;
        await this.save({ ...incident, recoveredAt, recoveryNote: sanitizeText(note, 200) });
        marked++;
      }
      return marked;
    }).catch((error) => {
      this.log(`No se pudo anotar la recuperación del incidente: ${sanitizeText(String(error), 200)}`);
      return 0;
    });
  }

  async record(input: IncidentInput): Promise<void> {
    try {
      const created = await this.exclusive(() => this.recordLocked(input));
      // El aviso va fuera del turno exclusivo: no debe retener a las demás operaciones.
      if (created) await this.onNew?.(created);
    } catch (error) {
      this.log(`No se pudo guardar el incidente: ${sanitizeText(String(error), 200)}`);
    }
  }

  /** Guarda o suma una repetición; devuelve el incidente solo si es nuevo. */
  private async recordLocked(input: IncidentInput): Promise<Incident | null> {
    const code = errorCodeOf(input.error);
    const existing = await this.list();
    const nowIso = this.now().toISOString();

    const repeat = existing.find(
      (i) =>
        i.status === "abierto" &&
        !i.recoveredAt &&
        i.portal === input.portal &&
        i.step === input.step &&
        i.errorCode === code &&
        this.now().getTime() - new Date(i.lastSeenAt).getTime() < REPEAT_WINDOW_MS,
    );
    if (repeat) {
      await this.save({ ...repeat, occurrences: repeat.occurrences + 1, lastSeenAt: nowIso });
      return null;
    }

    let structure: string | null = null;
    if (input.captureStructure) {
      try {
        structure = (await withTimeout(input.captureStructure(), CAPTURE_TIMEOUT_MS)) ?? null;
        if (structure && structure.length > STRUCTURE_MAX) structure = `${structure.slice(0, STRUCTURE_MAX)}…`;
      } catch (error) {
        this.log(`No se pudo capturar la estructura de la pantalla: ${sanitizeText(String(error), 200)}`);
      }
    }

    const incident: Incident = {
      id: Math.max(0, ...existing.map((i) => i.id)) + 1,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      occurrences: 1,
      portal: input.portal,
      step: input.step,
      errorCode: code,
      message: sanitizeText(input.error instanceof Error ? input.error.message : String(input.error)),
      reparable: !NOT_REPAIRABLE.has(code),
      publicationId: input.publicationId,
      structure,
      status: "abierto",
    };
    await this.save(incident);
    this.log(`Incidente #${incident.id} guardado (${incident.portal}, ${incident.step}, ${incident.errorCode}).`);
    return incident;
  }
}
