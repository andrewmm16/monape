import { describe, expect, it } from "vitest";
import { estimateExperienceFromDates } from "@/modules/evaluation/experience-dates";
import { findExplicitNegations, negationFor } from "@/modules/evaluation/negation";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import type { RequirementInput } from "@/modules/evaluation/types";

// reglas-v15: puntos ciegos hallados con el banco ciego 2 del 19/11/2026 (30 CV
// de puestos operativos y vacantes redactadas por otra persona; vara a ciegas).

const REF = new Date("2026-11-19T12:00:00Z");

function req(overrides: Partial<RequirementInput>): RequirementInput {
  return {
    id: "r",
    category: "habilidad_tecnica",
    priority: "obligatorio",
    description: "r",
    keywords: [],
    weight: 3,
    minYears: null,
    isEssential: false,
    ...overrides,
  };
}
const evaluar = (cv: string, r: RequirementInput) => evaluateWithRules(cv, [r], { referenceDate: REF })[0]!;

describe("secundaria completa", () => {
  const SECUNDARIA = req({ category: "formacion", description: "Secundaria completa", keywords: ["secundaria completa"] });

  it("«Secundaria completa» en la formación acredita", () => {
    expect(evaluar("FORMACIÓN\nSecundaria completa (2014)", SECUNDARIA).assessment).toBe("acreditado");
  });

  it("también abreviada: «Sec. completa»", () => {
    expect(evaluar("FORMACIÓN\nSec. completa - I.E. N° 1234, Ate (2013)", SECUNDARIA).assessment).toBe("acreditado");
  });

  it("y «5to de secundaria»", () => {
    expect(evaluar("ESTUDIOS\n5to de secundaria - Colegio Nacional (2019)", SECUNDARIA).assessment).toBe("acreditado");
  });

  it("«Secundaria incompleta» no la acredita", () => {
    const keyword = req({ category: "formacion", description: "Secundaria completa", keywords: ["secundaria"] });
    expect(evaluar("FORMACIÓN\nSecundaria incompleta (hasta 4to)", keyword).assessment).not.toBe("acreditado");
  });

  it("«tiempo completo» no es estudios terminados", () => {
    const contabilidad = req({ category: "formacion", description: "Estudios de Contabilidad", keywords: ["Contabilidad"] });
    expect(evaluar("Asistente de Contabilidad a tiempo completo", contabilidad).assessment).not.toBe("acreditado");
  });
});

describe("técnico titulado", () => {
  const TECNICO = req({
    category: "formacion",
    description: "Técnico titulado en Electricidad Industrial",
    keywords: ["técnico en electricidad", "Senati"],
  });

  it("un egresado sin título queda pendiente", () => {
    expect(evaluar("FORMACIÓN\nTéc. en Electricidad SENATI egresado (2020)", TECNICO).assessment).toBe("pendiente_verificacion");
  });

  it("al que le falta sustentar, también", () => {
    expect(evaluar("FORMACIÓN\nTécnico en Electricidad - SENATI, concluido; me falta sustentar", TECNICO).assessment).toBe(
      "pendiente_verificacion",
    );
  });

  it("con el título técnico, acredita", () => {
    expect(evaluar("FORMACIÓN\nTítulo de Técnico en Electricidad - SENATI (2018)", TECNICO).assessment).toBe("acreditado");
  });
});

describe("idiomas", () => {
  it("un certificado de inglés no se acredita con mencionar el inglés", () => {
    const certificado = req({
      category: "certificacion",
      description: "Certificado de inglés (TOEFL, Cambridge, ICPNA o similar)",
      keywords: ["TOEFL", "Cambridge", "ICPNA"],
    });
    expect(evaluar("IDIOMAS\nInglés intermedio\nEnglish - fluent", certificado).assessment).not.toBe("acreditado");
    expect(evaluar("IDIOMAS\nInglés avanzado - ICPNA (2019)", certificado).assessment).toBe("acreditado");
  });

  const B2 = req({ category: "idioma", description: "Inglés intermedio-avanzado (B2)", keywords: ["inglés"] });

  it("si el puesto pide B2, «intermedio» a secas no alcanza", () => {
    expect(evaluar("IDIOMAS\nInglés intermedio, lo básico para llamadas", B2).assessment).toBe("pendiente_verificacion");
  });

  it("«intermedio alto», «avanzado» o el código sí", () => {
    expect(evaluar("IDIOMAS\nInglés intermedio alto", B2).assessment).toBe("acreditado");
    expect(evaluar("IDIOMAS\nInglés avanzado", B2).assessment).toBe("acreditado");
    expect(evaluar("IDIOMAS\nInglés B2 (First Certificate)", B2).assessment).toBe("acreditado");
  });

  it("si el puesto pide B1, «intermedio» alcanza", () => {
    const B1 = req({ category: "idioma", description: "Inglés intermedio (B1)", keywords: ["inglés"] });
    expect(evaluar("IDIOMAS\nInglés intermedio", B1).assessment).toBe("acreditado");
  });
});

describe("encabezado «Cursos y conocimientos»", () => {
  const POS = req({ category: "herramienta", description: "Manejo de sistema de punto de venta", keywords: ["punto de venta"] });

  it("lo que enumera no es solo formación", () => {
    expect(evaluar("EXPERIENCIA\nVendedor 2021 - 2023\n\nCURSOS Y CONOCIMIENTOS\nManejo de punto de venta", POS).assessment).toBe(
      "acreditado",
    );
  });

  it("bajo «CURSOS» a secas sigue siendo un curso", () => {
    expect(evaluar("EXPERIENCIA\nVendedor 2021 - 2023\n\nCURSOS\nPunto de venta para retail (2022)", POS).assessment).toBe(
      "pendiente_verificacion",
    );
  });
});

describe("equivalencias de puestos operativos", () => {
  it("«auxiliar de almacén» es experiencia de operario de almacén", () => {
    const almacen = req({ category: "experiencia", description: "Experiencia como operario de almacén", keywords: ["operario de almacén"] });
    expect(evaluar("EXPERIENCIA\nAuxiliar de almacén | Importaciones Sol (2020 - 2022)", almacen).assessment).toBe("acreditado");
  });

  it("emitir facturas electrónicas es facturación electrónica", () => {
    const facturacion = req({ category: "herramienta", description: "Facturación electrónica", keywords: ["facturación electrónica"] });
    expect(evaluar("EXPERIENCIA\nCajera 2018 - actualidad\nEmisión de boletas y facturas electrónicas", facturacion).assessment).toBe(
      "acreditado",
    );
  });

  it("quien fue vendedor tiene experiencia en ventas", () => {
    const ventas = req({ category: "experiencia", description: "Experiencia en ventas", keywords: ["ventas"] });
    expect(evaluar("EXPERIENCIA\nVendedor de celulares | Cell Point 2021 - 2023", ventas).assessment).toBe("acreditado");
  });
});

describe("requisitos con «y» entre dos frases (reglas-v16)", () => {
  const IPERC = req({
    description: "Elaboración de matriz IPERC e investigación de accidentes",
    keywords: ["IPERC", "investigación de accidentes"],
  });

  it("con solo una de las dos partes queda por confirmar y dice cuál falta", () => {
    const item = evaluar("EXPERIENCIA\nPracticante de SST 2023 - 2024\nApoyo en la matriz IPERC del almacén", IPERC);
    expect(item.assessment).toBe("pendiente_verificacion");
    expect(item.rationale).toContain("«investigación de accidentes»");
  });

  it("con las dos, acredita", () => {
    expect(evaluar("EXPERIENCIA\nSupervisor SST 2020 - 2024\nMatriz IPERC e investigación de accidentes", IPERC).assessment).toBe(
      "acreditado",
    );
  });

  const STOCK = req({ description: "Manejo de inventarios y control de stock", keywords: ["inventario", "control de stock", "kardex"] });

  it("un término que no es de ninguna parte (kardex) no permite saber qué falta: no se exige más", () => {
    expect(evaluar("EXPERIENCIA\nAlmacenero 2019 - 2024\nCuadre con kardex", STOCK).assessment).toBe("acreditado");
  });

  it("solo «inventario» no cubre el control de stock", () => {
    expect(evaluar("EXPERIENCIA\nAyudante 2023\nApoyo en el inventario de fin de año", STOCK).assessment).toBe("pendiente_verificacion");
  });
});

describe("negaciones de documentos", () => {
  const LICENCIA = { description: "Licencia de conducir A-IIb vigente", keywords: ["licencia A-IIb", "brevete"] };

  it("«licencia en trámite» niega la licencia", () => {
    const negaciones = findExplicitNegations("Licencia A-IIb en trámite, aún no cuento con ella");
    expect(negationFor(LICENCIA, negaciones)).not.toBeNull();
  });

  it("«sin certificación ITIL» niega la certificación", () => {
    const negaciones = findExplicitNegations("Sin certificación ITIL ni CompTIA aún");
    expect(negationFor({ description: "Certificación ITIL Foundation", keywords: ["ITIL"] }, negaciones)).not.toBeNull();
  });

  it("una licencia vigente no se niega", () => {
    expect(negationFor(LICENCIA, findExplicitNegations("Licencia A-IIb vigente hasta 2028"))).toBeNull();
  });
});

describe("fechas de experiencia", () => {
  it("con la fecha en la línea del cargo, la descripción de abajo es de ese cargo", () => {
    const cv = [
      "EXPERIENCIA LABORAL",
      "Vendedor de celulares | Cell Point 01/21 – 03/23",
      "Atención al público, caja y cierre diario en tienda.",
      "Repositor | Minimarket Don Lucho 2019-2020",
      "Reposición de góndolas",
    ].join("\n");
    const estimado = estimateExperienceFromDates(cv, ["tienda"], REF);
    expect(estimado?.minYears).toBeCloseTo(27 / 12, 1);
  });

  it("el formato de LinkedIn (cargo arriba, «· 4 años» en la fecha) no cambia", () => {
    const cv = [
      "Experiencia",
      "Analista de soporte",
      "Mesa de ayuda Andina",
      "ene. de 2019 - dic. de 2022 · 4 años",
      "Soporte a usuarios",
      "Técnico de redes",
      "Redes Lima",
      "ene. de 2023 - nov. de 2026 · 3 años 11 meses",
    ].join("\n");
    expect(estimateExperienceFromDates(cv, ["mesa de ayuda"], REF)?.minYears).toBeCloseTo(4, 0);
  });

  it("el encabezado del Europass pegado al primer cargo abre la sección", () => {
    const cv = [
      "EXPERIENCIA LABORAL Supervisora de SST | Almacenes del Perú S.A.C.",
      "Febrero 2020 - actualidad",
      "Matriz IPERC en 4 sedes",
    ].join("\n");
    expect(estimateExperienceFromDates(cv, ["SST"], REF)?.minYears).toBeGreaterThan(6);
  });
});
