import { describe, expect, it } from "vitest";
import { evaluateWithRules } from "@/modules/evaluation/rule-engine";
import type { RequirementInput } from "@/modules/evaluation/types";

// reglas-v14: puntos ciegos hallados con el banco ciego del 19/11/2026 (30 CV
// escritos por alguien que no conocía el motor, con la vara puesta a ciegas).

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

const LEGISLACION = req({
  description: "Conocimiento de legislación laboral peruana (CTS, gratificaciones, liquidaciones)",
  keywords: ["legislación laboral"],
});

describe("cursos listados tras «Cursos:»", () => {
  it("un conocimiento que solo aparece en la lista «Cursos: …» queda pendiente", () => {
    const cv = "Experiencia\nAsistente administrativo 2021 - actualidad\nArchivo y mesa de partes.\n\nCursos: Legislación laboral básica, Gestión de personal.";
    const item = evaluar(cv, LEGISLACION);
    expect(item.assessment).toBe("pendiente_verificacion");
    expect(item.signal).toBe("solo_capacitacion");
  });

  it("también el segundo elemento de la lista, tras la coma", () => {
    const cv = "Experiencia\nAsistente administrativo 2021 - actualidad\n\nCursos: Gestión de personal, Legislación laboral básica.";
    expect(evaluar(cv, LEGISLACION).assessment).toBe("pendiente_verificacion");
  });

  it("si además lo aplicó en el trabajo, acredita", () => {
    const cv =
      "Experiencia\nAsistente de planillas 2021 - actualidad\nAplico la legislación laboral en el cálculo de CTS y gratificaciones.\n\nCursos: Legislación laboral básica.";
    expect(evaluar(cv, LEGISLACION).assessment).toBe("acreditado");
  });

  it("encabezados de cursos en inglés («Courses», «Training»)", () => {
    const cv = "Experience\nAdministrative assistant 2021 - present\n\nCOURSES\nLegislación laboral básica (2024)";
    expect(evaluar(cv, LEGISLACION).assessment).toBe("pendiente_verificacion");
  });
});

describe("certificación o curso en curso", () => {
  const TS = req({ category: "herramienta", description: "TypeScript", keywords: ["TypeScript"] });

  it("«TypeScript fundamentals (in progress)» como única mención queda pendiente", () => {
    const cv = "Experience\nJunior developer 2024 - present\nReact and JavaScript.\n\nCertifications\nTypeScript fundamentals (in progress)";
    expect(evaluar(cv, TS).assessment).toBe("pendiente_verificacion");
  });

  it("también si el PDF partió el paréntesis en dos líneas (columna angosta)", () => {
    const cv = "Experience\nJunior developer 2024 - present\nReact and JavaScript.\n\nCertifications\nTypeScript fundamentals (in\nprogress)\nOtra línea";
    expect(evaluar(cv, TS).assessment).toBe("pendiente_verificacion");
  });

  it("«(en curso)» en español también", () => {
    const cv = "Experiencia\nDesarrollador junior 2024 - actualidad\n\nCertificaciones\nTypeScript avanzado (en curso)";
    expect(evaluar(cv, TS).assessment).toBe("pendiente_verificacion");
  });

  it("un proyecto en curso donde usa la herramienta sigue acreditando", () => {
    const cv = "Experiencia\nDesarrollador 2022 - actualidad\nMigración del frontend a TypeScript (proyecto en curso).";
    expect(evaluar(cv, TS).assessment).toBe("acreditado");
  });
});

describe("nivel mínimo declarado con otras palabras", () => {
  const CRM = req({ category: "herramienta", description: "Manejo de CRM", keywords: ["CRM"] });

  it.each(["CRM (poco)", "CRM: poca experiencia", "Manejo escaso de CRM", "CRM (uso limitado)"])("«%s» queda pendiente", (linea) => {
    const cv = `Experiencia\nVendedor 2022 - actualidad\nVentas por teléfono.\nHabilidades\n${linea}`;
    expect(evaluar(cv, CRM).assessment).toBe("pendiente_verificacion");
  });

  it("«CRM» a secas sigue acreditando", () => {
    const cv = "Experiencia\nVendedor 2022 - actualidad\nSeguimiento de clientes en el CRM.";
    expect(evaluar(cv, CRM).assessment).toBe("acreditado");
  });
});

describe("niveles de idioma al estilo LinkedIn", () => {
  const INGLES = req({ category: "idioma", description: "Inglés técnico intermedio o superior", keywords: ["Inglés", "English"] });
  const AVANZADO = req({ category: "idioma", description: "Inglés avanzado", keywords: ["Inglés", "English"] });
  const cv = (linea: string) => `Experiencia\nDesarrollador 2020 - actualidad\nIdiomas\n${linea}`;

  it.each(["Inglés (Profesional completo)", "Inglés: competencia profesional completa", "English — Full professional proficiency", "Inglés (bilingüe)"])(
    "«%s» alcanza intermedio y avanzado",
    (linea) => {
      expect(evaluar(cv(linea), INGLES).assessment).toBe("acreditado");
      expect(evaluar(cv(linea), AVANZADO).assessment).toBe("acreditado");
    },
  );

  it.each(["Inglés: competencia básica profesional", "English — Professional working proficiency", "English — Limited working proficiency"])(
    "«%s» alcanza intermedio, pero no avanzado",
    (linea) => {
      expect(evaluar(cv(linea), INGLES).assessment).toBe("acreditado");
      expect(evaluar(cv(linea), AVANZADO).assessment).toBe("pendiente_verificacion");
    },
  );

  it("«Inglés: competencia básica» sigue siendo básico", () => {
    expect(evaluar(cv("Inglés: competencia básica"), INGLES).assessment).toBe("pendiente_verificacion");
  });
});

describe("siglas de los colegios profesionales del Perú", () => {
  const CEP = req({
    category: "formacion",
    description: "Colegiatura vigente en el Colegio de Enfermeros del Perú",
    keywords: ["colegiada", "colegiado", "Colegio de Enfermeros"],
    isEssential: true,
  });

  it("«CEP N.º 000000 (habilitada)» se reconoce; al ser legal, queda para verificar con documentos", () => {
    const cv = "Lic. Enf. Ana Ficticia\nCEP N.º 000000 (vigente - habilitada)\nExperiencia\nEnfermera de UCI 2022 - actualidad";
    const item = evaluar(cv, CEP);
    expect(item.assessment).toBe("pendiente_verificacion");
    expect(item.evidence.some((e) => e.quote.includes("CEP"))).toBe(true);
    // Lo que se le dice a RRHH: es legal, se verifica con documentos (no «puede estar en curso»).
    expect(item.rationale).toContain("debe verificarse con documentos");
    expect(item.rationale).not.toContain("puede estar en curso");
  });

  it("«Colegiatura en trámite» sigue diciendo que puede no estar concluida", () => {
    const cv = "Lic. Enf. Ana Ficticia\nColegio de Enfermeros: colegiatura en trámite\nExperiencia\nEnfermera de UCI 2022 - actualidad";
    const item = evaluar(cv, CEP);
    expect(item.assessment).toBe("pendiente_verificacion");
    expect(item.rationale).toContain("puede estar en curso");
  });

  it("«cep» en minúsculas dentro de otra palabra no cuenta", () => {
    const cv = "Experiencia\nAtención excepcional al paciente 2022 - actualidad";
    expect(evaluar(cv, CEP).assessment).toBe("sin_evidencia");
  });
});
