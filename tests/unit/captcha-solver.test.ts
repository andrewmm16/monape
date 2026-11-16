import { describe, expect, it } from "vitest";
import { clicsParaRotar, pasosArrastre, resolverAritmetica, respuestaTextoEstatico } from "../../bot/src/utils/captcha-solver";

describe("resolverAritmetica", () => {
  it("resuelve sumas, restas, multiplicaciones y divisiones en texto", () => {
    expect(resolverAritmetica("¿Cuánto es 7 + 5? (simulación)")).toBe(12);
    expect(resolverAritmetica("Resuelve: 8 - 3")).toBe(5);
    expect(resolverAritmetica("4 × 6 =")).toBe(24);
    expect(resolverAritmetica("3 * 9")).toBe(27);
    expect(resolverAritmetica("10 / 2")).toBe(5);
  });

  it("acepta las operaciones escritas con palabras", () => {
    expect(resolverAritmetica("cinco... 5 mas 4")).toBe(9);
    expect(resolverAritmetica("9 menos 2")).toBe(7);
    expect(resolverAritmetica("6 por 7")).toBe(42);
  });

  it("devuelve null ante texto no aritmético o división por cero", () => {
    expect(resolverAritmetica("Resuelve este acertijo")).toBeNull();
    expect(resolverAritmetica("8 / 0")).toBeNull();
  });
});

describe("respuestaTextoEstatico", () => {
  it("extrae la palabra entre comillas", () => {
    expect(respuestaTextoEstatico("Escribe la palabra «AZUL» para continuar.")).toBe("AZUL");
    expect(respuestaTextoEstatico('Teclea "Rojo" aquí')).toBe("Rojo");
  });

  it("si no hay comillas, toma la primera palabra en mayúsculas", () => {
    expect(respuestaTextoEstatico("Escribe VERDE para seguir")).toBe("VERDE");
  });

  it("devuelve null si no hay nada que extraer", () => {
    expect(respuestaTextoEstatico("escribe la palabra secreta")).toBeNull();
  });
});

describe("pasosArrastre", () => {
  it("genera una trayectoria que termina en el destino", () => {
    const pasos = pasosArrastre({ x: 0, y: 10 }, { x: 100, y: 10 }, 10);
    expect(pasos).toHaveLength(10);
    expect(pasos[0]).toEqual({ x: 10, y: 10 });
    expect(pasos.at(-1)).toEqual({ x: 100, y: 10 });
  });

  it("nunca produce cero pasos", () => {
    expect(pasosArrastre({ x: 0, y: 0 }, { x: 5, y: 0 }, 0)).toHaveLength(1);
  });
});

describe("clicsParaRotar", () => {
  it("cuenta los giros de 90° del ángulo actual al objetivo", () => {
    expect(clicsParaRotar(0, 0)).toBe(0);
    expect(clicsParaRotar(0, 90)).toBe(1);
    expect(clicsParaRotar(0, 180)).toBe(2);
    expect(clicsParaRotar(0, 270)).toBe(3);
  });

  it("gira solo hacia adelante (módulo 360) y redondea al múltiplo de 90", () => {
    expect(clicsParaRotar(270, 0)).toBe(1); // 270 → 360/0
    expect(clicsParaRotar(90, 0)).toBe(3);
    expect(clicsParaRotar(360, 90)).toBe(1);
    expect(clicsParaRotar(44, 90)).toBe(1); // 44 ≈ 0
  });
});
