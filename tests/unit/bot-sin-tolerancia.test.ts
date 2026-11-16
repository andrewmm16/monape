import { describe, expect, it } from "vitest";
// Importar el adaptador registra su libro de selectores ("linkedin").
import "../../bot/src/adapters/fake-linkedin";
import { loadConfig } from "../../bot/src/config";
import { getBook, quitarAlternativasTolerantes } from "../../bot/src/selectors";

describe("modo sin tolerancia (forzar la reparación por IA)", () => {
  it("quita las alternativas tolerantes de una clave y conserva el selector por defecto", () => {
    const antes = getBook("linkedin")?.campo_titulo;
    expect(antes).toBeDefined();
    expect(antes!.alternativas.length).toBeGreaterThan(0);

    quitarAlternativasTolerantes("linkedin", "campo_titulo");

    const despues = getBook("linkedin")?.campo_titulo;
    expect(despues!.alternativas).toEqual([]);
    expect(despues!.selector).toBe(antes!.selector);
  });

  it("no falla si el portal o la clave no existen", () => {
    expect(() => quitarAlternativasTolerantes("portal-inexistente", "campo_titulo")).not.toThrow();
    expect(() => quitarAlternativasTolerantes("linkedin", "clave-inexistente")).not.toThrow();
  });
});

describe("loadConfig: BOT_SIN_TOLERANCIA", () => {
  const base = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };

  it("por defecto está apagado", () => {
    expect(loadConfig(base).sinTolerancia).toBe(false);
  });

  it("se activa con «true»", () => {
    expect(loadConfig({ ...base, BOT_SIN_TOLERANCIA: "true" }).sinTolerancia).toBe(true);
  });
});
