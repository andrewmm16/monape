import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readDesafios, registrarDesafio, resumirDesafios } from "../../bot/src/captcha/metrica";

/** Registro y resumen de la métrica de desafíos, en un archivo temporal (no toca bot/.state). */

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "desafios-"));
  dirs.push(dir);
  return path.join(dir, "desafios.json");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("registrarDesafio / readDesafios", () => {
  it("agrega eventos con marca de tiempo y los relee", () => {
    const file = tempFile();
    registrarDesafio({ portal: "linkedin", tipo: "slider", resuelto: true, intentos: 1 }, file);
    registrarDesafio({ portal: "linkedin", tipo: "casilla", resuelto: false, intentos: 3 }, file);
    const eventos = readDesafios(file);
    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toMatchObject({ portal: "linkedin", tipo: "slider", resuelto: true, intentos: 1 });
    expect(typeof eventos[0]!.timestamp).toBe("string");
  });

  it("un archivo inexistente se lee como lista vacía (nunca lanza)", () => {
    expect(readDesafios(path.join(tmpdir(), "no-existe-desafios.json"))).toEqual([]);
  });
});

describe("resumirDesafios", () => {
  it("cuenta total, resueltos y desglosa por portal y por tipo", () => {
    const resumen = resumirDesafios([
      { timestamp: "t", portal: "linkedin", tipo: "slider", resuelto: true, intentos: 1 },
      { timestamp: "t", portal: "linkedin", tipo: "slider", resuelto: false, intentos: 3 },
      { timestamp: "t", portal: "indeed", tipo: "otp", resuelto: true, intentos: 1 },
    ]);
    expect(resumen.total).toBe(3);
    expect(resumen.resueltos).toBe(2);
    expect(resumen.porPortal.linkedin).toEqual({ total: 2, resueltos: 1 });
    expect(resumen.porPortal.indeed).toEqual({ total: 1, resueltos: 1 });
    expect(resumen.porTipo.slider).toEqual({ total: 2, resueltos: 1 });
    expect(resumen.porTipo.otp).toEqual({ total: 1, resueltos: 1 });
  });
});
