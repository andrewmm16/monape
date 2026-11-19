import { describe, expect, it } from "vitest";
import { auditRequirement, auditRequirements } from "@/modules/evaluation/requirement-audit";
import type { RequirementInput } from "@/modules/evaluation/types";

function req(overrides: Partial<RequirementInput> = {}): RequirementInput {
  return {
    id: "r1",
    category: "habilidad_tecnica",
    priority: "obligatorio",
    description: "Requisito",
    keywords: ["Concar"],
    weight: 5,
    minYears: null,
    isEssential: false,
    ...overrides,
  };
}

const problemas = (r: RequirementInput) => auditRequirement(r).map((h) => h.problema).join(" | ");

describe("auditRequirement", () => {
  it("una configuración correcta no genera ninguna observación", () => {
    // Dos términos independientes: ninguno coincide dentro del otro.
    expect(auditRequirement(req({ description: "Sistema contable", keywords: ["Concar", "Starsoft"] }))).toEqual([]);
  });

  it("avisa de que un requisito sin términos no se puede evaluar", () => {
    const hallazgos = auditRequirement(req({ keywords: [] }));
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.gravedad).toBe("bloquea");
    expect(hallazgos[0]!.problema).toContain("no tiene términos de búsqueda");
  });

  it("los términos en blanco cuentan como ausentes", () => {
    expect(auditRequirement(req({ keywords: ["  ", ""] }))[0]!.gravedad).toBe("bloquea");
  });

  it("avisa de una palabra de uso corriente como término", () => {
    expect(problemas(req({ keywords: ["experiencia"] }))).toContain("uso corriente");
  });

  describe("términos demasiado amplios (banco ciego 2)", () => {
    it("«disponibilidad» sola: la trae casi cualquier CV («disponibilidad inmediata»)", () => {
      const hallazgos = auditRequirement(
        req({ category: "otro", description: "Disponibilidad para turnos rotativos", keywords: ["turnos rotativos", "disponibilidad"] }),
      );
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toMatchObject({ gravedad: "riesgo" });
      expect(hallazgos[0]!.problema).toContain("«disponibilidad inmediata»");
    });

    it("«redes» sola coincide con «redes sociales»", () => {
      expect(problemas(req({ description: "Redes básicas (TCP/IP)", keywords: ["redes", "TCP/IP"] }))).toContain("«redes sociales»");
    });

    it("la expresión concreta no avisa", () => {
      expect(auditRequirement(req({ description: "Redes LAN", keywords: ["redes LAN", "normas de seguridad"] }))).toEqual([]);
    });

    it("en competencias no avisa: el motor nunca las da por cumplidas", () => {
      expect(auditRequirement(req({ category: "competencia", description: "Comunicación efectiva", keywords: ["comunicación"] }))).toEqual([]);
    });
  });

  describe("términos cortos", () => {
    it("un término corto sin ningún respaldo largo es un riesgo", () => {
      const hallazgos = auditRequirement(req({ description: "Inglés B2", keywords: ["B2"] }));
      expect(hallazgos.some((h) => h.gravedad === "riesgo" && h.problema.includes("2 caracteres"))).toBe(true);
    });

    it("un respaldo largo que CONTIENE el término corto no es respaldo", () => {
      // El caso medido en el banco de CV escaneados: «(B2)» leído «(82)».
      const hallazgos = auditRequirement(
        req({ description: "Inglés intermedio (B2)", keywords: ["B2", "Inglés intermedio (B2)"] }),
      );
      expect(hallazgos.some((h) => h.gravedad === "riesgo" && h.problema.includes("un solo carácter"))).toBe(true);
    });

    it("un respaldo largo independiente resuelve el riesgo", () => {
      const hallazgos = auditRequirement(
        req({ description: "Inglés intermedio (B2)", keywords: ["B2", "inglés intermedio"] }),
      );
      expect(hallazgos.filter((h) => h.gravedad === "riesgo")).toEqual([]);
    });
  });

  describe("términos redundantes", () => {
    it("señala el término que el motor ya encontraría dentro de otro", () => {
      expect(problemas(req({ description: "SAP", keywords: ["SAP", "SAP MM"] }))).toContain("«SAP MM» no añade nada");
    });

    it("NO señala uno que el límite de palabra deja fuera", () => {
      // «AFP» no coincide dentro de «AFPnet»: el motor exige límite de palabra
      // en los extremos alfanuméricos. Aconsejar quitarlo perdería cobertura.
      expect(problemas(req({ description: "Aportes AFP", keywords: ["AFP", "AFPnet"] }))).not.toContain("AFPnet");
    });

    it("sí señala el plural que las variantes del motor ya cubren", () => {
      expect(problemas(req({ description: "Inventarios", keywords: ["inventario", "inventarios"] }))).toContain(
        "«inventarios» no añade nada",
      );
    });
  });

  it("avisa si un requisito de formación no nombra el grado en la descripción", () => {
    const sinGrado = req({ category: "formacion", description: "Formación en Contabilidad", keywords: ["Contabilidad"] });
    expect(problemas(sinGrado)).toContain("no distinguirá un egresado de un titulado");

    const conGrado = req({ category: "formacion", description: "Título profesional en Contabilidad", keywords: ["Contabilidad"] });
    expect(problemas(conGrado)).not.toContain("egresado");
  });

  it("avisa si el nivel está en los términos pero no en la descripción", () => {
    const soloEnTerminos = req({ category: "herramienta", description: "Excel", keywords: ["Excel avanzado"] });
    expect(problemas(soloEnTerminos)).toContain("lee el nivel exigido en la DESCRIPCIÓN");

    const enLaDescripcion = req({ category: "herramienta", description: "Excel nivel avanzado", keywords: ["Excel avanzado"] });
    expect(problemas(enLaDescripcion)).not.toContain("DESCRIPCIÓN");
  });
});

describe("auditRequirements", () => {
  it("ordena los hallazgos de lo que bloquea a lo que solo se puede mejorar", () => {
    const { hallazgos } = auditRequirements([
      req({ id: "a", description: "Excel", keywords: ["Excel avanzado"] }),
      req({ id: "b", keywords: [] }),
    ]);
    expect(hallazgos.map((h) => h.gravedad)).toEqual(["bloquea", "riesgo"]);
  });

  it("avisa cuando los requisitos esenciales copan el peso", () => {
    const { hallazgos, pesoEsencial } = auditRequirements([
      req({ id: "a", weight: 8, isEssential: true }),
      req({ id: "b", weight: 2 }),
    ]);
    expect(pesoEsencial).toBe(80);
    expect(hallazgos.some((h) => h.problema.includes("80 % del peso"))).toBe(true);
  });

  it("no avisa del peso esencial cuando es minoritario", () => {
    const { hallazgos, pesoEsencial } = auditRequirements([
      req({ id: "a", weight: 2, isEssential: true }),
      req({ id: "b", weight: 8 }),
    ]);
    expect(pesoEsencial).toBe(20);
    expect(hallazgos.some((h) => h.problema.includes("del peso"))).toBe(false);
  });

  it("una vacante sin requisitos no revienta", () => {
    expect(auditRequirements([])).toEqual({ hallazgos: [], pesoEsencial: 0 });
  });
});
