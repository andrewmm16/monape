import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Lo que el portal devolvió al publicar una oferta. */
export interface PublishRecord {
  externalId: string;
  externalUrl: string;
}

/**
 * Diario de ofertas ya publicadas en el portal cuyo resultado AÚN no se informó a
 * la app. Se escribe en disco justo después de publicar y antes de informar: si
 * el informe falla (app caída) o el robot se reinicia, la app volverá a entregar
 * el trabajo como «publicar» y, sin este diario, se crearía una segunda oferta
 * real. Con él, el robot reenvía el resultado guardado en vez de publicar otra vez.
 */
export interface PublishJournal {
  get(publicationId: string): PublishRecord | undefined;
  set(publicationId: string, record: PublishRecord): void;
  remove(publicationId: string): void;
}

export class MemoryPublishJournal implements PublishJournal {
  private readonly records = new Map<string, PublishRecord>();
  get(publicationId: string): PublishRecord | undefined {
    return this.records.get(publicationId);
  }
  set(publicationId: string, record: PublishRecord): void {
    this.records.set(publicationId, record);
  }
  remove(publicationId: string): void {
    this.records.delete(publicationId);
  }
}

export class FilePublishJournal implements PublishJournal {
  private readonly records = new Map<string, PublishRecord>();

  constructor(
    private readonly file: string,
    log: (message: string) => void = () => {},
  ) {
    let raw: string | null = null;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      // Aún no existe: diario vacío.
    }
    if (raw === null) return;
    try {
      const data: unknown = JSON.parse(raw);
      for (const [id, record] of Object.entries(data && typeof data === "object" ? data : {})) {
        const { externalId, externalUrl } = (record ?? {}) as Partial<PublishRecord>;
        if (typeof externalId === "string" && typeof externalUrl === "string") this.records.set(id, { externalId, externalUrl });
      }
    } catch {
      // Un diario ilegible no debe pasar desapercibido: podría haber ofertas publicadas sin informar.
      log(`ATENCIÓN: el diario de publicaciones (${file}) está dañado; revise en el portal si hay ofertas sin registrar.`);
    }
  }

  get(publicationId: string): PublishRecord | undefined {
    return this.records.get(publicationId);
  }

  set(publicationId: string, record: PublishRecord): void {
    this.records.set(publicationId, record);
    this.persist();
  }

  remove(publicationId: string): void {
    if (this.records.delete(publicationId)) this.persist();
  }

  /** Escritura atómica: un corte a mitad de camino no deja el archivo a medias. */
  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.records)));
    renameSync(tmp, this.file);
  }
}
