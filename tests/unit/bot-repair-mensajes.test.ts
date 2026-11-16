import { describe, expect, it } from "vitest";
import { proposalMessage, sinArregloMessage } from "../../bot/src/repair";

const base = {
  incidenteId: 7,
  portal: "linkedin",
  selector: "#li-titulo-v2",
  clave: "campo_titulo",
  confianza: "alta" as const,
  razon: "El id cambió a li-titulo-v2.",
  ensayo: { resultado: "paso" as const, mensaje: "", en: "2026-11-06T17:00:00.000Z" },
};

describe("mensaje único de reparación", () => {
  it("con arreglo probado: dice el cambio, la pausa y la acción, en un solo mensaje", () => {
    const m = proposalMessage({ ...base, probada: true });
    expect(m).toContain("El portal linkedin cambió (#7)");
    expect(m).toContain("pausé ese portal, los demás siguen");
    expect(m).toContain("usar «#li-titulo-v2» como campo_titulo");
    expect(m).toContain("«sí 7»");
    expect(m).toContain("«no 7»");
  });

  it("sin probar aún: menciona que se verifica tras aprobar y los minutos de reversión", () => {
    const m = proposalMessage({ ...base, probada: false }, 30);
    expect(m).toContain("sin probar aún");
    expect(m).toContain("se revierte solo");
    expect(m).toContain("30 min");
  });
});

describe("mensaje único cuando no hay arreglo", () => {
  it("sin reintento programado: solo dice que hay que revisar el adaptador", () => {
    const m = sinArregloMessage(7, "bumeran", 0);
    expect(m).toContain("El portal bumeran cambió (#7)");
    expect(m).toContain("No encontré un arreglo automático");
    expect(m).toContain("revisar el adaptador");
    expect(m).not.toContain("reintento");
  });

  it("con reintento programado: menciona cada cuántos minutos reintenta solo", () => {
    expect(sinArregloMessage(7, "bumeran", 10)).toContain("cada 10 min");
  });
});
