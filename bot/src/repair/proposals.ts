import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getBook, validateSelector, getOverride, type OverrideEntry } from "../selectors";
import type { Respuesta } from "./client";

export type EstadoPropuesta = "propuesta" | "aplicada" | "revertida" | "rechazada";

/** Una propuesta de selector para un incidente: `bot/.state/propuestas/<idIncidente>.json`. */
export interface Propuesta {
  incidenteId: number;
  portal: string;
  clave: string;
  selector: string;
  confianza: "baja" | "media" | "alta";
  razon: string;
  modelo: string;
  /** Tokens que costó la consulta (el coste lo calcula quien revise estos números). */
  tokensEntrada: number;
  tokensSalida: number;
  creadaEn: string;
  estado: EstadoPropuesta;
  /** El ensayo (healthCheck con el selector en memoria) pasó. Solo una propuesta probada, o marcada «sin probar» por no estar cubierta, se puede aplicar con «sí N». */
  probada: boolean;
  /** Consultas al modelo que costó llegar a esta propuesta (cada una cuenta para el límite diario). */
  intentos: number;
  ensayo: { resultado: "paso" | "fallo" | "no_cubierto"; mensaje: string; en: string };
  aplicadaEn?: string;
  /** La comprobación del portal pasó con el override aplicado. */
  verificadaEn?: string;
  revertidaEn?: string;
  motivoReversion?: string;
  rechazadaEn?: string;
  /** Override que había antes de aplicar esta propuesta (para restaurarlo si se revierte). */
  overrideAnterior?: OverrideEntry | null;
}

/** ¿Se puede aplicar con «sí N»? Probada, o sin probar porque la prueba de estructura no cubre ese paso. */
export const isApplicable = (p: Pick<Propuesta, "probada" | "ensayo">): boolean => p.probada || p.ensayo.resultado === "no_cubierto";

export type ValidacionPropuesta = { ok: true; clave: string; selector: string } | { ok: false; motivo: string };

/**
 * Valida lo que dijo el modelo ANTES de guardarlo: la clave debe existir en el libro de ese portal y
 * el selector debe ser aceptable (≤200 caracteres, sin `<`, `{`, `}`, `;`, `javascript:` ni saltos de línea).
 */
export function validateProposal(portal: string, respuesta: Respuesta): ValidacionPropuesta {
  if (respuesta.sin_propuesta) return { ok: false, motivo: "el modelo respondió «sin propuesta»" };
  const clave = respuesta.clave.trim();
  const book = getBook(portal);
  if (!book || !Object.hasOwn(book, clave)) return { ok: false, motivo: `la clave «${clave.slice(0, 60)}» no existe en el libro de ${portal}` };
  const selector = respuesta.selector.trim();
  const problem = validateSelector(selector);
  if (problem) return { ok: false, motivo: `selector descartado: ${problem}` };
  // Las claves con marcadores (p. ej. la marca del paso {n}) no admiten un selector fijo.
  if (book[clave]!.selector?.includes("{")) return { ok: false, motivo: `la clave «${clave}» es parametrizada y no admite un selector fijo` };
  const current = getOverride(portal, clave)?.selector ?? book[clave]!.selector;
  if (current === selector) return { ok: false, motivo: "el selector propuesto es el mismo que ya está vigente" };
  return { ok: true, clave, selector };
}

const pad = (id: number) => String(id).padStart(4, "0");

/** Día local (AAAA-MM-DD) de una fecha. */
export const dayOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** Propuestas en archivos JSON (uno por incidente), con escritura atómica y operaciones de una en una. */
export class ProposalStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private file(incidentId: number) {
    return path.join(this.dir, `${pad(incidentId)}.json`);
  }

  private async write(file: string, data: unknown): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(tmp, file);
  }

  private chain: Promise<unknown> = Promise.resolve();
  /** Las operaciones sobre los archivos van de una en una: dos a la vez podrían pisarse. */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.then(operation, operation);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Lectura tolerante: un archivo dañado o a medias se ignora. */
  async get(incidentId: number): Promise<Propuesta | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file(incidentId), "utf8")) as Propuesta;
      return parsed && parsed.incidenteId === incidentId ? parsed : null;
    } catch {
      return null;
    }
  }

  async list(): Promise<Propuesta[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: Propuesta[] = [];
    for (const name of names.filter((n) => /^\d{4,}\.json$/.test(n)).sort()) {
      try {
        out.push(JSON.parse(await readFile(path.join(this.dir, name), "utf8")) as Propuesta);
      } catch {
        // dañado: se ignora
      }
    }
    return out;
  }

  save(propuesta: Propuesta): Promise<void> {
    return this.exclusive(() => this.write(this.file(propuesta.incidenteId), propuesta));
  }

  /** Cambia campos de una propuesta (de forma exclusiva). Devuelve la propuesta resultante, o `null` si no existe. */
  update(incidentId: number, patch: (current: Propuesta) => Partial<Propuesta> | null): Promise<Propuesta | null> {
    return this.exclusive(async () => {
      const current = await this.get(incidentId);
      if (!current) return null;
      const changes = patch(current);
      if (!changes) return current;
      const next = { ...current, ...changes };
      await this.write(this.file(incidentId), next);
      return next;
    });
  }

  // ---- límite diario: se cuentan las consultas al modelo (también las que no dieron propuesta), no solo las guardadas

  private get usageFile() {
    return path.join(this.dir, "_uso.json");
  }

  private async readUsage(): Promise<{ dia: string; consultas: number }> {
    try {
      const parsed = JSON.parse(await readFile(this.usageFile, "utf8")) as { dia?: unknown; consultas?: unknown };
      if (typeof parsed.dia === "string" && typeof parsed.consultas === "number") return { dia: parsed.dia, consultas: parsed.consultas };
    } catch {
      // sin archivo o dañado: se empieza de cero
    }
    return { dia: "", consultas: 0 };
  }

  /** Reserva una consulta del día: `false` si ya se alcanzó el límite. */
  reserveQuery(maxPerDay: number): Promise<boolean> {
    return this.exclusive(async () => {
      const today = dayOf(this.now());
      const usage = await this.readUsage();
      const consultas = usage.dia === today ? usage.consultas : 0;
      if (consultas >= maxPerDay) return false;
      await this.write(this.usageFile, { dia: today, consultas: consultas + 1 });
      return true;
    });
  }
}
