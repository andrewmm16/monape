import { describe, expect, it } from "vitest";
import { celdasCorrectas, verificarDesafio, type Desafio } from "../../bot/src/fake-portal/model";

/** Verificación pura de cada tipo de desafío (sin DOM ni red), incluido el honeypot. */

const base = (extra: Partial<Desafio> & { tipo: Desafio["tipo"] }): Desafio => ({ a: 0, b: 0, ...extra });

describe("verificarDesafio", () => {
  it("suma: acepta el resultado correcto y rechaza el resto", () => {
    const d = base({ tipo: "suma", a: 7, b: 5 });
    expect(verificarDesafio(d, { respuesta: "12" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "13" })).toBe(false);
    expect(verificarDesafio(d, { respuesta: "" })).toBe(false);
  });

  it("texto: compara sin distinguir mayúsculas y usa la palabra por defecto", () => {
    expect(verificarDesafio(base({ tipo: "texto", palabra: "VERDE" }), { respuesta: "verde" })).toBe(true);
    expect(verificarDesafio(base({ tipo: "texto" }), { respuesta: "azul" })).toBe(true); // por defecto AZUL
    expect(verificarDesafio(base({ tipo: "texto", palabra: "VERDE" }), { respuesta: "rojo" })).toBe(false);
  });

  it("slider: acepta dentro de la tolerancia alrededor del objetivo", () => {
    const d = base({ tipo: "slider", objetivo: 200, tolerancia: 6 });
    expect(verificarDesafio(d, { respuesta: "200" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "205" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "190" })).toBe(false);
  });

  it("casilla: exige la marca y un tiempo mínimo en pantalla", () => {
    const d = base({ tipo: "casilla" });
    expect(verificarDesafio(d, { respuesta: "ok", tiempo: "600" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "ok", tiempo: "100" })).toBe(false); // demasiado rápido
    expect(verificarDesafio(d, { respuesta: "", tiempo: "600" })).toBe(false);
  });

  it("imagenes: exige exactamente el conjunto de celdas correctas", () => {
    const d = base({ tipo: "imagenes", celdas: [true, false, true, false, false, false, false, false, true] });
    expect(celdasCorrectas(d)).toEqual([0, 2, 8]);
    expect(verificarDesafio(d, { respuesta: "0,2,8" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "8,2,0" })).toBe(true); // el orden no importa
    expect(verificarDesafio(d, { respuesta: "0,2" })).toBe(false); // falta una
    expect(verificarDesafio(d, { respuesta: "0,2,8,5" })).toBe(false); // sobra una
  });

  it("rotar: acepta cualquier ángulo congruente con el objetivo (módulo 360)", () => {
    const d = base({ tipo: "rotar", anguloObjetivo: 270 });
    expect(verificarDesafio(d, { respuesta: "270" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "-90" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "180" })).toBe(false);
  });

  it("otp: exige el código exacto", () => {
    const d = base({ tipo: "otp", codigo: "246810" });
    expect(verificarDesafio(d, { respuesta: "246810" })).toBe(true);
    expect(verificarDesafio(d, { respuesta: "000000" })).toBe(false);
  });

  it("honeypot: si el campo trampa trae algo, falla aunque la respuesta sea correcta", () => {
    const d = base({ tipo: "suma", a: 2, b: 2 });
    expect(verificarDesafio(d, { respuesta: "4", trampa: "lo que sea" })).toBe(false);
    expect(verificarDesafio(d, { respuesta: "4", trampa: "" })).toBe(true);
  });
});
