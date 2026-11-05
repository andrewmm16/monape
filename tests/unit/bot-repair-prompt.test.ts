import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../bot/src/repair/prompt";

const incident = { id: 7, portal: "trabajos-diarios", step: "publicar", errorCode: "pagina_cambio", message: "no se halló el campo", structure: "{}" };

describe("buildPrompt con memoria de reparaciones", () => {
  it("sin memoria, no añade sección de historial", () => {
    const { prompt } = buildPrompt({ incident });
    expect(prompt).not.toContain("Historial de reparaciones");
  });

  it("con memoria vacía, tampoco añade sección", () => {
    const { prompt } = buildPrompt({ incident, memoria: [] });
    expect(prompt).not.toContain("Historial de reparaciones");
  });

  it("con memoria, añade el selector verificado y los selectores a evitar", () => {
    const { prompt } = buildPrompt({
      incident,
      memoria: [{ clave: "campo_titulo", selectorVerificado: "#titulo-v2", verificadoEn: "2026-10-30T00:00:00Z", selectoresFallidos: ["#titulo"], vecesReparada: 2 }],
    });
    expect(prompt).toContain("Historial de reparaciones");
    expect(prompt).toContain("campo_titulo");
    expect(prompt).toContain("#titulo-v2");
    expect(prompt).toContain("#titulo");
  });

  it("el system prompt instruye a aprovechar el historial", () => {
    const { system } = buildPrompt({ incident });
    expect(system.toLowerCase()).toContain("historial");
  });
});
