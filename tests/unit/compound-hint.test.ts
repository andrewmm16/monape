import { describe, expect, it } from "vitest";
import { requirementCompoundHint } from "@/modules/vacancies/compound-hint";

describe("aviso de requisito compuesto en el formulario", () => {
  it("siglas o nombres propios unidos por «y»: informa que el motor exigirá todos", () => {
    expect(requirementCompoundHint("S10 y MS Project", "S10, MS Project")).toEqual({
      tipo: "exige_todos",
      terminos: ["S10", "MS Project"],
    });
  });

  it("nombres comunes unidos por «y»: sugiere separarlos si son cosas distintas", () => {
    expect(requirementCompoundHint("Contabilidad y finanzas", "contabilidad, finanzas")).toEqual({
      tipo: "separar",
      terminos: ["contabilidad", "finanzas"],
    });
  });

  it("dos frases con sus términos unidas por «e»: el motor exigirá las dos (reglas-v16)", () => {
    expect(
      requirementCompoundHint(
        "Elaboración de matriz IPERC e investigación de accidentes",
        "IPERC, investigación de accidentes",
        "habilidad_tecnica",
      ),
    ).toEqual({ tipo: "exige_todos", terminos: ["IPERC", "investigación de accidentes"] });
  });

  it("en competencias, las frases con «y» siguen sin exigirse a la vez", () => {
    expect(
      requirementCompoundHint("Trato cordial con clientes y cumplimiento de horarios", "trato cordial, cumplimiento de horarios", "competencia")
        ?.tipo,
    ).not.toBe("exige_todos");
  });

  it("con «o» son alternativas: no avisa", () => {
    expect(requirementCompoundHint("Manejo de WMS o ERP (SAP)", "WMS, SAP")).toBeNull();
  });

  it("sin «y» no avisa", () => {
    expect(requirementCompoundHint("Excel avanzado", "Excel")).toBeNull();
  });

  it("si la descripción nombra un solo término configurado, no avisa", () => {
    expect(requirementCompoundHint("Contabilidad y finanzas", "contabilidad")).toBeNull();
  });

  it("sin términos todavía, no avisa", () => {
    expect(requirementCompoundHint("Ventas y cobranzas", "")).toBeNull();
  });
});
