import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Correos ya atendidos, por hash del Message-ID (nunca direcciones ni texto), con el
 * código del resultado. Es solo una optimización: la app sigue deduplicando por
 * oferta e id externo, así que perder este archivo no duplica nada.
 */
export interface StateStore {
  has(hash: string): boolean;
  add(hash: string, code: string): void;
}

export class MemoryStateStore implements StateStore {
  private readonly seen = new Map<string, string>();
  has(hash: string): boolean {
    return this.seen.has(hash);
  }
  add(hash: string, code: string): void {
    this.seen.set(hash, code);
  }
}

export class FileStateStore implements StateStore {
  private readonly seen: Map<string, string>;

  constructor(private readonly file: string) {
    this.seen = new Map(this.load());
  }

  private load(): [string, string][] {
    try {
      const data: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
      return Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string");
    } catch {
      return [];
    }
  }

  has(hash: string): boolean {
    return this.seen.has(hash);
  }

  add(hash: string, code: string): void {
    this.seen.set(hash, code);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.seen)));
    renameSync(tmp, this.file);
  }
}
