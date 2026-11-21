import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ERROR_CODES, HUMAN_REQUIRED, errorCodeOf } from "../../bot/src/errors";
import { acquireLock } from "../../bot/src/lock";

describe("candado de instancia única", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "robot-lock-"));
    file = path.join(dir, "robot.lock");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("toma el candado (número y hora de inicio del proceso) y lo libera", () => {
    const release = acquireLock(file, process.pid, () => null, 1_700_000_000_000);
    expect(readFileSync(file, "utf8")).toBe(`${process.pid} 1700000000000`);
    release();
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  it("rechaza un segundo robot mientras el primero está vivo", () => {
    // El proceso padre de las pruebas está vivo y no es este mismo.
    writeFileSync(file, String(process.ppid));
    expect(() => acquireLock(file)).toThrow(/Ya hay otro robot/);
  });

  it("descarta el candado escrito antes del último arranque de la PC aunque su número de proceso esté en uso", () => {
    // Tras reiniciar, Windows puede dar el mismo número de proceso a otro programa (p. ej. svchost).
    writeFileSync(file, String(process.ppid));
    const beforeBoot = (Date.now() - uptime() * 1000) / 1000 - 3600;
    utimesSync(file, beforeBoot, beforeBoot);
    const release = acquireLock(file);
    expect(readFileSync(file, "utf8").split(" ")[0]).toBe(String(process.pid));
    release();
  });

  it("descarta el candado si ese número de proceso ahora es de otro programa (Inicio rápido de Windows)", () => {
    // Mismo arranque de la PC (no sirve la comprobación anterior), pero el proceso vivo empezó en otra hora.
    writeFileSync(file, `${process.ppid} 1700000000000`);
    const release = acquireLock(file, process.pid, () => 1_700_000_000_000 + 60 * 60_000);
    expect(readFileSync(file, "utf8").split(" ")[0]).toBe(String(process.pid));
    release();
  });

  it("rechaza si el proceso vivo es el mismo robot (la hora de inicio coincide)", () => {
    writeFileSync(file, `${process.ppid} 1700000000000`);
    expect(() => acquireLock(file, process.pid, () => 1_700_000_000_000 + 2_000)).toThrow(/Ya hay otro robot/);
  });

  it("si no se puede saber la hora de inicio, manda el candado (como antes)", () => {
    writeFileSync(file, `${process.ppid} 1700000000000`);
    expect(() => acquireLock(file, process.pid, () => null)).toThrow(/Ya hay otro robot/);
  });

  it("descarta el candado de un proceso que ya no existe", () => {
    writeFileSync(file, "2147483646");
    const release = acquireLock(file);
    expect(readFileSync(file, "utf8").split(" ")[0]).toBe(String(process.pid));
    release();
  });
});

describe("navegador cerrado", () => {
  it("no se confunde con un cambio del portal y exige a una persona", () => {
    const error = new Error("browserContext.newPage: Target page, context or browser has been closed");
    expect(errorCodeOf(error)).toBe(ERROR_CODES.browserClosed);
    expect(HUMAN_REQUIRED.has(ERROR_CODES.browserClosed)).toBe(true);
    expect(errorCodeOf(new Error("Timeout 15000ms exceeded"))).toBe(ERROR_CODES.pageChanged);
  });
});
