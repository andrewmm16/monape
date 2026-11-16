import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Recuerda en disco el último día (clave de Lima) en que se envió el resumen. */
export class DailySummaryState {
  constructor(private readonly file: string) {}

  lastSent(): string | null {
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as { lastSentDate?: string };
      return data.lastSentDate ?? null;
    } catch {
      return null;
    }
  }

  markSent(date: string): void {
    // Un fallo al guardar no debe detener al robot (a lo sumo, se reenvía el resumen).
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ lastSentDate: date }));
    } catch {
      /* ignorado a propósito */
    }
  }
}
