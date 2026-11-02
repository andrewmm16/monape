import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("toma el candado y lo libera", () => {
    const release = acquireLock(file);
    expect(readFileSync(file, "utf8")).toBe(String(process.pid));
    release();
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  it("rechaza un segundo robot mientras el primero está vivo", () => {
    // El proceso padre de las pruebas está vivo y no es este mismo.
    writeFileSync(file, String(process.ppid));
    expect(() => acquireLock(file)).toThrow(/Ya hay otro robot/);
  });

  it("descarta el candado de un proceso que ya no existe", () => {
    writeFileSync(file, "2147483646");
    const release = acquireLock(file);
    expect(readFileSync(file, "utf8")).toBe(String(process.pid));
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
