import { describe, expect, it } from "vitest";
import { resumirMemoria } from "../../bot/src/repair/memoria";
import type { Propuesta } from "../../bot/src/repair/proposals";

const P = (over: Partial<Propuesta>): Propuesta => ({
  incidenteId: 1,
  portal: "trabajos-diarios",
  clave: "campo_titulo",
  selector: "#x",
  confianza: "media",
  razon: "",
  modelo: "m",
  tokensEntrada: 0,
  tokensSalida: 0,
  creadaEn: "2026-10-01T00:00:00Z",
  estado: "propuesta",
  probada: true,
  intentos: 1,
  ensayo: { resultado: "paso", mensaje: "", en: "" },
  ...over,
});

describe("resumirMemoria", () => {
  it("sin propuestas, devuelve vacío", () => {
    expect(resumirMemoria([], "trabajos-diarios")).toEqual([]);
  });

  it("resume la verificada y marca a evitar las revertidas/rechazadas", () => {
    const props = [
      P({ clave: "campo_titulo", selector: "#titulo", estado: "revertida", creadaEn: "2026-10-01T00:00:00Z" }),
      P({ clave: "campo_titulo", selector: "#titulo-v2", estado: "aplicada", verificadaEn: "2026-10-30T00:00:00Z", creadaEn: "2026-10-30T00:00:00Z" }),
    ];
    const [m] = resumirMemoria(props, "trabajos-diarios");
    expect(m).toMatchObject({ clave: "campo_titulo", selectorVerificado: "#titulo-v2", vecesReparada: 1 });
    expect(m!.selectoresFallidos).toEqual(["#titulo"]);
  });

  it("un selector que al final se verificó no aparece en «evitar»", () => {
    const props = [
      P({ selector: "#a", estado: "revertida", creadaEn: "2026-10-01T00:00:00Z" }),
      P({ selector: "#a", estado: "aplicada", verificadaEn: "2026-10-05T00:00:00Z", creadaEn: "2026-10-05T00:00:00Z" }),
    ];
    expect(resumirMemoria(props, "trabajos-diarios")[0]!.selectoresFallidos).toEqual([]);
  });

  it("clave sin verificada: solo lista de evitar, sin selectorVerificado", () => {
    const props = [P({ selector: "#malo", estado: "rechazada" })];
    const [m] = resumirMemoria(props, "trabajos-diarios");
    expect(m!.selectorVerificado).toBeUndefined();
    expect(m!.selectoresFallidos).toEqual(["#malo"]);
  });

  it("respeta el tope maxFallidosPorClave", () => {
    const fallidos = Array.from({ length: 9 }, (_, i) => P({ selector: `#f${i}`, estado: "revertida", creadaEn: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z` }));
    const [m] = resumirMemoria(fallidos, "trabajos-diarios", { maxFallidosPorClave: 5 });
    expect(m!.selectoresFallidos).toHaveLength(5);
  });

  it("respeta el tope maxClaves", () => {
    const props = Array.from({ length: 15 }, (_, i) => P({ clave: `clave_${i}`, selector: `#s${i}`, estado: "revertida" }));
    expect(resumirMemoria(props, "trabajos-diarios", { maxClaves: 12 })).toHaveLength(12);
  });

  it("filtra por portal", () => {
    const props = [P({ portal: "bumeran", selector: "#b", estado: "revertida" })];
    expect(resumirMemoria(props, "trabajos-diarios")).toEqual([]);
  });

  it("ignora claves sin nada que aportar (ni verificada ni fallidos)", () => {
    const props = [P({ clave: "campo_titulo", selector: "#x", estado: "propuesta" })];
    expect(resumirMemoria(props, "trabajos-diarios")).toEqual([]);
  });
});
