import { describe, expect, it } from "vitest";
import { evaluateWithRules, findYearsNear, RULE_ENGINE_VERSION } from "@/modules/evaluation/rule-engine";
import { findTermOccurrences, normalizeForSearch } from "@/modules/evaluation/text";
import type { RequirementInput } from "@/modules/evaluation/types";

const CV = `María Ficticia Quispe
Analista de Datos con 4 años de experiencia en análisis comercial.
Herramientas: Microsoft Excel avanzado, Power   BI, SQL Server.
Formación: Bachiller en Ingeniería Industrial — Universidad Ficticia del Perú.
Lideré un equipo de 3 personas en proyectos de mejora continua.`;

function req(id: string, overrides: Partial<RequirementInput>): RequirementInput {
  return {
    id,
    category: "habilidad_tecnica",
    priority: "obligatorio",
    description: id,
    keywords: [],
    weight: 3,
    minYears: null,
    isEssential: false,
    ...overrides,
  };
}

describe("búsqueda de términos", () => {
  it("ignora mayúsculas, tildes y espacios múltiples", () => {
    const haystack = normalizeForSearch(CV);
    expect(findTermOccurrences(haystack, "power bi")).toHaveLength(1);
    expect(findTermOccurrences(haystack, "ingenieria industrial")).toHaveLength(1);
  });

  it("respeta límites de palabra", () => {
    const haystack = normalizeForSearch("Experiencia con MySQL y NoSQL");
    expect(findTermOccurrences(haystack, "SQL")).toHaveLength(0);
    expect(findTermOccurrences(haystack, "MySQL")).toHaveLength(1);
  });

  it("encuentra términos con símbolos como C# o .NET", () => {
    const haystack = normalizeForSearch("Desarrollo en C# y .NET Core");
    expect(findTermOccurrences(haystack, "C#")).toHaveLength(1);
    expect(findTermOccurrences(haystack, ".NET")).toHaveLength(1);
  });
});

describe("motor de reglas", () => {
  it("acredita requisitos con evidencia literal del CV", () => {
    const [result] = evaluateWithRules(CV, [req("excel", { keywords: ["Excel"] })]);
    expect(result!.assessment).toBe("acreditado");
    expect(result!.evidence[0]!.quote).toContain("Excel avanzado");
    const { start, end } = result!.evidence[0]!;
    expect(CV.slice(start, end)).toBe("Excel");
  });

  it("marca 'sin evidencia' (no 'no cumplido') cuando el CV no menciona el requisito", () => {
    const [result] = evaluateWithRules(CV, [req("sap", { keywords: ["SAP", "SAP FI"] })]);
    expect(result!.assessment).toBe("sin_evidencia");
    expect(result!.evidence).toEqual([]);
    expect(result!.rationale).toContain("no implica que la persona no cumpla");
  });

  it("nunca produce 'no cumplido'", () => {
    const results = evaluateWithRules(CV, [
      req("a", { keywords: ["Python"] }),
      req("b", { keywords: ["Excel"], minYears: 10 }),
      req("c", { keywords: [] }),
    ]);
    expect(results.map((r) => r.assessment)).not.toContain("no_cumplido");
  });

  it("deja pendientes de verificación los requisitos sin términos configurados", () => {
    const [result] = evaluateWithRules(CV, [req("x", { keywords: [] })]);
    expect(result!.assessment).toBe("pendiente_verificacion");
  });

  it("las competencias mencionadas quedan pendientes de verificación", () => {
    const [result] = evaluateWithRules(CV, [req("lid", { category: "competencia", keywords: ["equipo", "lideré"] })]);
    expect(result!.assessment).toBe("pendiente_verificacion");
    expect(result!.evidence.length).toBeGreaterThan(0);
  });

  it("los requisitos legales o esenciales requieren verificación documental", () => {
    const [result] = evaluateWithRules(CV, [
      req("bach", { category: "formacion", keywords: ["Bachiller en Ingeniería Industrial"], isEssential: true }),
    ]);
    expect(result!.assessment).toBe("pendiente_verificacion");
    expect(result!.evidence[0]!.quote).toContain("Bachiller");
  });

  it("evalúa años mínimos solo con menciones explícitas cercanas", () => {
    const [enough, tooFew] = evaluateWithRules(CV, [
      req("exp3", { category: "experiencia", keywords: ["análisis comercial"], minYears: 3 }),
      req("exp6", { category: "experiencia", keywords: ["análisis comercial"], minYears: 6 }),
    ]);
    expect(enough!.assessment).toBe("acreditado");
    expect(tooFew!.assessment).toBe("pendiente_verificacion");
    expect(tooFew!.rationale).toContain("4 años");
  });

  it("detecta años de experiencia escritos con o sin tilde", () => {
    for (const text of ["5 anos de experiencia en logística", "Experiencia laboral de más de 5 años en logística"]) {
      const haystack = normalizeForSearch(text);
      expect(findYearsNear(haystack, findTermOccurrences(haystack, "logística"))).toBe(5);
    }
  });

  it("no toma la edad ni la antigüedad de una empresa como años de experiencia", () => {
    const [age, company] = evaluateWithRules(
      "María Ficticia, 26 años. Bachiller en Contabilidad. Trabajó en una empresa con más de 30 años en el mercado como asistente contable.",
      [
        req("edad", { category: "experiencia", keywords: ["Contabilidad"], minYears: 3 }),
        req("empresa", { category: "experiencia", keywords: ["asistente contable"], minYears: 3 }),
      ],
    );
    expect(age!.assessment).toBe("pendiente_verificacion");
    expect(company!.assessment).toBe("pendiente_verificacion");
    expect(age!.rationale).not.toContain("26");
  });

  it("usa la mención de experiencia más cercana al término, no la mayor del CV", () => {
    const haystack = normalizeForSearch(
      "10 años de experiencia en ventas minoristas. Además, 1 año de experiencia en SQL para reportes.",
    );
    expect(findYearsNear(haystack, findTermOccurrences(haystack, "SQL"))).toBe(1);
  });

  it("es determinista", () => {
    const requirements = [req("excel", { keywords: ["Excel", "Power BI"] })];
    expect(evaluateWithRules(CV, requirements)).toEqual(evaluateWithRules(CV, requirements));
  });
});

describe("años de experiencia calculados con las fechas del CV", () => {
  const referenceDate = new Date("2026-06-15T12:00:00Z");
  const run = (text: string, requirement: RequirementInput) => evaluateWithRules(text, [requirement], { referenceDate })[0]!;
  const cv = (...lines: string[]) => ["María Ficticia", "Experiencia laboral", ...lines].join("\n");
  const exp = (minYears: number, overrides: Partial<RequirementInput> = {}) =>
    req("exp", { category: "experiencia", keywords: ["Excel"], minYears, ...overrides });
  const dated = cv("Analista de Datos", "Empresa Uno", "03/2019 - 12/2022", "- Reportes en Excel");

  it("usa la versión reglas-v3", () => {
    expect(RULE_ENGINE_VERSION).toBe("reglas-v3");
  });

  it("acredita cuando la cota mínima por fechas alcanza el mínimo", () => {
    const result = run(dated, exp(3));
    expect(result.assessment).toBe("acreditado");
    expect(result.rationale).toContain("Según las fechas de experiencia del CV relacionadas con estos términos, suma al menos 3.8 años");
    expect(result.rationale).toContain("calculado al 15/06/2026; mínimo: 3");
    expect(result.evidence.map((e) => e.quote)).toEqual(["03/2019 - 12/2022"]);
  });

  it("deja pendiente (no 'no cumplido') si las fechas suman menos que el mínimo", () => {
    const result = run(dated, exp(5));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("suma 3.8 años");
    expect(result.rationale).toContain("Puede existir experiencia adicional sin fechas: verificar");
  });

  it("si solo el año marca la diferencia entre la cota mínima y la máxima, queda pendiente", () => {
    const result = run(cv("Analista Excel", "2019 - 2022"), exp(3));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("entre 2.2 y 4 años (algunas fechas solo indican el año)");
    expect(result.rationale).toContain("Verificar");
  });

  it("año solo: se acredita si basta con la cota mínima", () => {
    expect(run(cv("Analista Excel", "2015 - 2022"), exp(3)).assessment).toBe("acreditado");
  });

  it("un requisito esencial acreditado por fechas queda pendiente", () => {
    const result = run(dated, exp(3, { isEssential: true }));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("suma al menos 3.8 años");
    expect(result.rationale).toContain("legal o esencial");
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("no atribuye las fechas de otra entrada a los términos", () => {
    const text = cv("Cajero", "Empresa Uno", "01/2010 - 12/2020", "- Caja", "- Atención", "- Archivo", "Analista", "Empresa Dos", "01/2021 - 06/2021", "- Excel");
    const result = run(text, exp(3));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("suma 0.5 años");
  });

  it("la mención explícita sigue acreditando con su mensaje original, aun sin fechas", () => {
    const result = run("Analista con 5 años de experiencia en Excel.", exp(3));
    expect(result.assessment).toBe("acreditado");
    expect(result.rationale).toContain("Se menciona explícitamente 5 años de experiencia (mínimo: 3)");
  });

  it("la mención explícita prevalece sobre las fechas cuando basta", () => {
    const text = cv("Analista con 6 años de experiencia en Excel", "03/2019 - 12/2019");
    const result = run(text, exp(5));
    expect(result.assessment).toBe("acreditado");
    expect(result.rationale).toContain("Se menciona explícitamente 6 años");
  });

  it("esencial con mención explícita conserva su mensaje", () => {
    const result = run("Analista con 5 años de experiencia en Excel.", exp(3, { isEssential: true }));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("Se menciona 5 años de experiencia. Al ser un requisito legal o esencial");
  });

  it("sin fechas ni mención explícita conserva los mensajes anteriores", () => {
    const result = run("Uso Excel a diario.", exp(3));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("No se pudo determinar la duración de la experiencia");
  });

  it("sin encabezado de experiencia, las fechas de estudios no acreditan años", () => {
    const text = ["María Ficticia", "Formación académica", "Curso de Excel", "2010 - 2018"].join("\n");
    const result = run(text, exp(3));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("No se pudo determinar la duración");
  });

  it("la fecha de referencia cambia el cálculo de periodos en curso, de forma determinista", () => {
    const text = cv("Analista Excel", "01/2024 - actualidad");
    const early = evaluateWithRules(text, [exp(2)], { referenceDate: new Date("2025-06-15T12:00:00Z") })[0]!;
    const late = evaluateWithRules(text, [exp(2)], { referenceDate })[0]!;
    expect(early.assessment).toBe("pendiente_verificacion");
    expect(late.assessment).toBe("acreditado");
    expect(evaluateWithRules(text, [exp(2)], { referenceDate })).toEqual([late]);
  });
});

// Implementación anterior (cuadrática), conservada solo para comprobar que el resultado no cambió.
function referenceNormalize(original: string) {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < original.length; i++) {
    const char = original[i]!;
    if (/\s/.test(char)) {
      if (text.length > 0 && !text.endsWith(" ")) {
        text += " ";
        map.push(i);
      }
      continue;
    }
    for (const normalized of char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()) {
      text += normalized;
      map.push(i);
    }
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

describe("normalizeForSearch", () => {
  it("da el mismo resultado exacto que la implementación anterior", () => {
    const samples = [
      "",
      "   ",
      "  Árbol\t\tde  Ñandú\r\nSEGUNDA línea  ",
      "́ sueltó y  espacios duros  ",
      "a ́ b",
      "İstanbul Ünï​code 😀 fin ",
      CV,
    ];
    for (const sample of samples) expect(normalizeForSearch(sample)).toEqual(referenceNormalize(sample));
  });

  it("es lineal en textos largos con muchos espacios", () => {
    const started = performance.now();
    const result = normalizeForSearch("1 ".repeat(100000));
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.text).toHaveLength(199999);
  });
});

describe("reglas-v3: oraciones, años y variantes", () => {
  const CONTADORA = `Carmen Quispe
Contadora Pública Colegiada | Asistente Contable
Contadora pública colegiada con 6 años de experiencia en contabilidad general, tributación peruana y cierres mensuales.
Registré y concilié más de 800 comprobantes mensuales en SAP Business One.`;
  const REF = new Date("2026-11-03T00:00:00Z");
  const years = (overrides: Partial<RequirementInput> = {}) =>
    evaluateWithRules(CONTADORA, [req("exp", { keywords: ["contabilidad", "contable"], minYears: 3, category: "experiencia", ...overrides })], {
      referenceDate: REF,
    })[0]!;

  it("la evidencia de los años es la oración que los menciona, no la cabecera", () => {
    const result = years();
    expect(result.assessment).toBe("acreditado");
    expect(result.evidence[0]!.quote).toContain("6 años de experiencia en contabilidad general");
    expect(result.evidence[0]!.quote).not.toMatch(/^Carmen/);
    expect(result.rationale).toContain("6 años");
  });

  it("no acredita si los años no alcanzan el mínimo", () => {
    expect(years({ minYears: 8 }).assessment).toBe("pendiente_verificacion");
  });

  it("entiende años escritos con letras y otras formas", () => {
    const found = (text: string) => findYearsNear(normalizeForSearch(text), [{ start: 0, end: 4 }]);
    expect(found("Cargo con tres años de experiencia en ventas")).toBe(3);
    expect(found("Cargo, 5+ años de experiencia en ventas")).toBe(5);
    expect(found("Ventas: cuatro años como ejecutivo comercial")).toBe(4);
    expect(found("Ventas, experiencia de más de 7 años")).toBe(7);
    expect(found("Ventas: 2 años trabajando en retail")).toBe(2);
  });

  it("no confunde la edad ni la antigüedad de una empresa con experiencia", () => {
    const found = (text: string) => findYearsNear(normalizeForSearch(text), [{ start: 0, end: 4 }]);
    expect(found("Ventas. Tengo 26 años y vivo en Lima")).toBeNull();
    expect(found("Ventas en una empresa con 30 años en el mercado")).toBeNull();
  });

  it("prefiere la mención de años de la misma oración que el término", () => {
    const text = "Trabajé en ventas durante la campaña. Antes: 10 años de experiencia en logística. Ventas minoristas con 2 años de experiencia.";
    const haystack = normalizeForSearch(text);
    const matches = findTermOccurrences(haystack, "ventas minoristas");
    expect(findYearsNear(haystack, matches, text)).toBe(2);
  });

  it("encuentra singular, plural y género", () => {
    const [plural] = evaluateWithRules("Revisé comprobantes de pago y facturas.", [req("c", { keywords: ["comprobante de pago"] })]);
    expect(plural!.assessment).toBe("acreditado");
    const [genero] = evaluateWithRules("Trabajo como contadora en una empresa.", [req("g", { keywords: ["contador"] })]);
    expect(genero!.assessment).toBe("acreditado");
    expect(genero!.evidence[0]!.matched).toEqual(["contadora"]);
  });

  it("no mezcla palabras distintas aunque se parezcan", () => {
    const [result] = evaluateWithRules("Buen contacto con clientes y contable.", [req("c", { keywords: ["contador"] })]);
    expect(result!.assessment).toBe("sin_evidencia");
  });

  it("la evidencia es la oración completa y reúne los términos distintos", () => {
    const text = "Manejo Excel. Elaboré reportes en Excel avanzado con tablas dinámicas y BUSCARV para gerencia. Otro párrafo.";
    const [result] = evaluateWithRules(text, [req("x", { keywords: ["Excel", "tablas dinámicas", "BUSCARV"] })]);
    expect(result!.evidence.map((e) => e.quote)).toContain("Elaboré reportes en Excel avanzado con tablas dinámicas y BUSCARV para gerencia.");
  });

  it("una mención negada no acredita el requisito", () => {
    const [negado] = evaluateWithRules("Sin experiencia en SAP, pero con ganas de aprender.", [req("sap", { keywords: ["SAP"] })]);
    expect(negado!.assessment).toBe("pendiente_verificacion");
    expect(negado!.rationale).toContain("parecen negarlo");
    const [mixto] = evaluateWithRules("Sin experiencia en SAP. Luego usé SAP Business One a diario.", [req("sap", { keywords: ["SAP"] })]);
    expect(mixto!.assessment).toBe("acreditado");
  });
});

describe("reglas-v3: formación y nivel", () => {
  const titulo = req("t", { description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] });

  it("el término en un cargo o un interés no acredita una formación", () => {
    const [interes] = evaluateWithRules("Asistente Administrativa con interés en Contabilidad", [titulo]);
    expect(interes!.assessment).toBe("pendiente_verificacion");
    expect(interes!.rationale).toContain("expresar un interés");
    const [cargo] = evaluateWithRules("Asistente Contable en Empresa SAC. Atención de clientes.", [req("t2", { ...titulo, keywords: ["Contable"] })]);
    expect(cargo!.assessment).toBe("pendiente_verificacion");
  });

  it("acredita la formación cuando está en una frase de estudios", () => {
    const [bachiller] = evaluateWithRules("Bachiller en Contabilidad - Universidad Ficticia (2021)", [titulo]);
    expect(bachiller!.assessment).toBe("acreditado");
    const [uni] = evaluateWithRules("Contabilidad, Universidad Nacional Ficticia, 2016-2021", [titulo]);
    expect(uni!.assessment).toBe("acreditado");
  });

  it("un nivel básico no acredita un puesto que pide nivel intermedio o avanzado", () => {
    const excel = req("x", { description: "Excel intermedio-avanzado", keywords: ["Excel"], category: "herramienta" });
    const [basico] = evaluateWithRules("Manejo de Excel básico para reportes.", [excel]);
    expect(basico!.assessment).toBe("pendiente_verificacion");
    expect(basico!.rationale).toContain("nivel básico");
    const [intermedio] = evaluateWithRules("Excel básico-intermedio para reportes.", [excel]);
    expect(intermedio!.assessment).toBe("acreditado");
    const [avanzado] = evaluateWithRules("Excel avanzado con tablas dinámicas.", [excel]);
    expect(avanzado!.assessment).toBe("acreditado");
  });
});

describe("reglas-v3: estudios en curso e intereses", () => {
  it("estudios en curso no acreditan un título", () => {
    const titulo = req("t", { description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] });
    const [encurso] = evaluateWithRules("Contabilidad (6.º ciclo de 10, en curso) - Instituto Superior Lima Sur", [titulo]);
    expect(encurso!.assessment).toBe("pendiente_verificacion");
    expect(encurso!.rationale).toContain("puede estar en curso");
  });

  it("un interés o una aspiración no acredita nada", () => {
    const [interes] = evaluateWithRules("Asistente Administrativa con interés en Contabilidad", [req("c", { keywords: ["Contabilidad"] })]);
    expect(interes!.assessment).toBe("pendiente_verificacion");
    expect(interes!.rationale).toContain("expresar un interés");
  });
});
