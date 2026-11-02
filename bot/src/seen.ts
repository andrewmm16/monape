import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Postulantes que ya se entregaron a la app, para no volver a bajar sus CV en
 * cada ciclo. Es solo una optimización: la app sigue deduplicando por oferta e
 * id externo, así que perder este archivo no duplica nada.
 */
export interface SeenStore {
  has(publicationId: string, externalId: string): boolean;
  add(publicationId: string, externalId: string): void;
}

export class MemorySeenStore implements SeenStore {
  private readonly seen = new Set<string>();
  has(publicationId: string, externalId: string): boolean {
    return this.seen.has(`${publicationId}:${externalId}`);
  }
  add(publicationId: string, externalId: string): void {
    this.seen.add(`${publicationId}:${externalId}`);
  }
}

export class FileSeenStore implements SeenStore {
  private readonly seen: Set<string>;

  constructor(private readonly file: string) {
    this.seen = new Set(this.load());
  }

  private load(): string[] {
    try {
      const data: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(data) ? data.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  has(publicationId: string, externalId: string): boolean {
    return this.seen.has(`${publicationId}:${externalId}`);
  }

  add(publicationId: string, externalId: string): void {
    this.seen.add(`${publicationId}:${externalId}`);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.seen]));
    renameSync(tmp, this.file);
  }
}
