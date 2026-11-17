import { describe, expect, it } from "vitest";
import { evaluateRequirement, evaluateWithRules, findYearsNear, RULE_ENGINE_VERSION } from "@/modules/evaluation/rule-engine";
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

  it("ignora el guion suave y las marcas de ancho cero que deja el PDF", () => {
    const haystack = normalizeForSearch("Experiencia en contabi­lidad general");
    expect(findTermOccurrences(haystack, "contabilidad")).toHaveLength(1);
  });

  it("une las palabras que el PDF parte con un guion al final de la línea", () => {
    const haystack = normalizeForSearch("Experiencia en contabi-\nlidad general");
    expect(findTermOccurrences(haystack, "contabilidad")).toHaveLength(1);
  });

  it("no une un guion que separa dos datos ni un rango de años", () => {
    expect(findTermOccurrences(normalizeForSearch("Analista contable -\nEmpresa Uno"), "contable")).toHaveLength(1);
    expect(normalizeForSearch("Analista contable 2019-\n2020").text).toContain("2019- 2020");
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

  it("si las fechas contradicen los años declarados, no se acredita por el texto (reglas-v7)", () => {
    // Declara 6 años pero las fechas solo cubren ~9 meses: posible CV inflado.
    const text = cv("Analista con 6 años de experiencia en Excel", "03/2019 - 12/2019");
    const result = run(text, exp(5));
    expect(result.assessment).toBe("pendiente_verificacion");
    expect(result.rationale).toContain("Declara 6 años de experiencia");
    expect(result.rationale).toContain("las fechas del CV suman como mucho");
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

// Las tres reglas de limpieza de reglas-v4 escritas de otra forma, para que el
// cross-check valga: aquí se tokeniza con expresiones regulares y arreglos,
// mientras la implementación real recorre caracteres con un Uint8Array.
const esSuelto = (texto: string) => texto.length === 1 && /\p{L}/u.test(texto);

function referenceLetterGaps(original: string): Set<number> {
  const gaps = new Set<number>();
  for (const linea of original.matchAll(/[^\r\n]+/g)) {
    const tokens = [...linea[0]!.matchAll(/\S+/g)].map((t) => ({
      texto: t[0],
      en: linea.index + t.index,
      fin: linea.index + t.index + t[0].length,
    }));
    const sueltos = tokens.filter((t) => esSuelto(t.texto));
    if (sueltos.length < 4 || sueltos.length < tokens.length * 0.6) continue;
    for (let k = 1; k < tokens.length; k++) {
      const previo = tokens[k - 1]!;
      const actual = tokens[k]!;
      if (esSuelto(previo.texto) && esSuelto(actual.texto) && actual.en - previo.fin === 1) gaps.add(previo.fin);
    }
  }
  return gaps;
}

// Implementación directa (cuadrática), conservada solo para comprobar que la
// versión rápida da exactamente el mismo resultado.
function referenceNormalize(original: string) {
  let text = "";
  const map: number[] = [];
  const gaps = referenceLetterGaps(original);
  for (let i = 0; i < original.length; i++) {
    const char = original[i]!;
    if (/[­​-‍⁠﻿]/.test(char)) continue;
    if (gaps.has(i)) continue;
    if (/[-‐‑]/.test(char) && text.length > 0 && /[\p{L}\p{N}]/u.test(text[text.length - 1]!)) {
      const corte = /^[^\S\r\n]*\r?\n\s*(?=\p{L})/u.exec(original.slice(i + 1));
      if (corte) {
        i += corte[0].length;
        continue;
      }
    }
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
  return { text, map, original };
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
      "C O N T A B I L I D A D   G E N E R A L",
      "E X P E R I E N C I A\nManejo de SAP y Excel a nivel avanzado",
      "a b c\nA  B  C  D\nM F M F M F",
      CV,
    ];
    for (const sample of samples) expect(normalizeForSearch(sample)).toEqual(referenceNormalize(sample));
  });

  it("reconstruye las palabras que el PDF abrió letra por letra", () => {
    const { text } = normalizeForSearch("C O N T A B I L I D A D   G E N E R A L");
    expect(text).toBe("contabilidad general");
  });

  it("no toca la prosa normal con palabras de una letra", () => {
    const { text } = normalizeForSearch("Manejo de SAP y Excel a nivel avanzado, e informes");
    expect(text).toBe("manejo de sap y excel a nivel avanzado, e informes");
  });

  it("solo reconstruye la línea afectada, no el resto del documento", () => {
    const { text } = normalizeForSearch("E X P E R I E N C I A\nAnalista de costos y presupuestos");
    expect(text).toBe("experiencia analista de costos y presupuestos");
  });

  it("si el PDF pierde la frontera de palabra, las letras quedan pegadas", () => {
    // Límite real: Chromium + pdf.js dejan UN espacio también entre palabras,
    // así que el dato con el que separarlas no está en el fichero. Lo cubre la
    // comparación sin espacios de los encabezados (experience-dates.ts).
    expect(normalizeForSearch("E X P E R I E N C I A L A B O R A L").text).toBe("experiencialaboral");
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

  it("encuentra el femenino de un término de varias palabras", () => {
    const [titulo] = evaluateWithRules("Ingeniera Sanitaria con experiencia en redes de agua.", [
      req("s", { keywords: ["Ingeniero Sanitario"] }),
    ]);
    expect(titulo!.assessment).toBe("acreditado");
    expect(titulo!.evidence[0]!.matched).toEqual(["Ingeniera Sanitaria"]);
    const [cargo] = evaluateWithRules("Contadora Pública colegiada.", [req("c", { keywords: ["Contador Público"] })]);
    expect(cargo!.assessment).toBe("acreditado");
    const [plural] = evaluateWithRules("Buscamos ingenieras sanitarias.", [req("p", { keywords: ["Ingeniero Sanitario"] })]);
    expect(plural!.assessment).toBe("acreditado");
  });

  it("en el femenino de varias palabras no cambia el complemento", () => {
    const [result] = evaluateWithRules("Licenciada en Administración de Negocios.", [
      req("l", { keywords: ["Licenciado en Administración"] }),
    ]);
    expect(result!.assessment).toBe("acreditado");
  });

  it("no pasa un término femenino de varias palabras a masculino", () => {
    const [result] = evaluateWithRules("Capacidad de trabajo bajo tensión.", [req("bt", { keywords: ["baja tensión"] })]);
    expect(result!.assessment).toBe("sin_evidencia");
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

  it("la colegiatura acredita la formación: implica una carrera concluida", () => {
    const tituloContador = req("tc", {
      description: "Título o bachiller en Contabilidad",
      keywords: ["Contabilidad", "Contador"],
      category: "formacion",
    });
    const juzgar = (texto: string) => evaluateWithRules(texto, [tituloContador])[0]!;
    expect(juzgar("Contadora Pública Colegiada | Asistente Contable").assessment).toBe("acreditado");
    expect(juzgar("Colegiada en el Colegio de Contadores Públicos de Lima.").assessment).toBe("acreditado");
    expect(juzgar("Contador Público, colegiatura vigente.").assessment).toBe("acreditado");
    // Lo que no es un título sigue sin acreditarse.
    expect(juzgar("Estudiante de Contabilidad, VIII ciclo.").assessment).toBe("pendiente_verificacion");
    // «Colegio» a secas es el nivel secundario, no una carrera.
    expect(juzgar("Secretaria en el Colegio San José. Apoyo al área de Contabilidad.").assessment).toBe("pendiente_verificacion");
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

describe("reglas-v4: huecos encontrados con el banco adversario", () => {
  it("una colegiatura en trámite no acredita el título", () => {
    const titulo = req("t", { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] });
    const [tramite] = evaluateWithRules("Contabilidad: colegiatura en trámite, expediente presentado.", [titulo]);
    expect(tramite!.assessment).toBe("pendiente_verificacion");
  });

  it("«conocimientos nulos de Excel» no acredita Excel", () => {
    const excel = req("x", { category: "herramienta", description: "Manejo de Excel", keywords: ["Excel"] });
    const [nulos] = evaluateWithRules("Conocimientos nulos de Excel.", [excel]);
    expect(nulos!.assessment).toBe("pendiente_verificacion");
  });

  it("reconoce «- a la actualidad» como empleo en curso", () => {
    const exp = req("e", { category: "experiencia", description: "2 años en contabilidad", keywords: ["contable"], minYears: 2 });
    const texto = ["Experiencia laboral", "Asistente contable | Empresa Uno | 03/2024 - a la actualidad"].join("\n");
    const [actual] = evaluateWithRules(texto, [exp], { referenceDate: new Date("2026-11-03T12:00:00.000Z") });
    expect(actual!.assessment).toBe("acreditado");
  });

  it("una pista de estudios lejana no acredita la formación", () => {
    const titulo = req("t", { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] });
    // Hoja extraída de un PDF sin saltos de línea: el título es en Administración
    // y «Contabilidad» aparece 60 caracteres después, en el cargo.
    const hoja =
      "FORMACIÓN ACADÉMICA Bachiller en Administración de Empresas Universidad Ficticia 2016-2021 EXPERIENCIA Asistente de Contabilidad en Comercial SAC 2022-2026";
    expect(evaluateWithRules(hoja, [titulo])[0]!.assessment).toBe("pendiente_verificacion");
    expect(evaluateWithRules(hoja.replace(" EXPERIENCIA", "\nEXPERIENCIA"), [titulo])[0]!.assessment).toBe("pendiente_verificacion");
    // Con la pista al lado del término sí acredita.
    expect(evaluateWithRules("Bachiller en Contabilidad, Universidad Ficticia 2021.", [titulo])[0]!.assessment).toBe("acreditado");
  });

  it("el nivel se lee del ítem de la enumeración, no de los vecinos", () => {
    const excel = req("x", { category: "herramienta", description: "Excel intermedio-avanzado", keywords: ["Excel"] });
    const ingles = req("i", { category: "idioma", description: "Inglés intermedio", keywords: ["inglés"] });
    expect(evaluateWithRules("Herramientas: Excel (nivel básico) y Power BI avanzado.", [excel])[0]!.assessment).toBe(
      "pendiente_verificacion",
    );
    expect(evaluateWithRules("Idiomas: inglés básico, francés avanzado.", [ingles])[0]!.assessment).toBe("pendiente_verificacion");
    // Un rango declarado dentro del mismo ítem sí acredita.
    expect(evaluateWithRules("Herramientas: Excel básico-intermedio, Word avanzado.", [excel])[0]!.assessment).toBe("acreditado");
  });

  it("la sección de referencias no acredita nada: habla de otra persona", () => {
    const titulo = req("t", { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contador"] });
    const cv = [
      "Ana Ficticia Salas",
      "Asistente administrativa con 3 años de experiencia.",
      "Referencias personales",
      "Juan Pérez Soto, Contador Público Colegiado, jefe directo en Comercial SAC.",
    ].join("\n");
    expect(evaluateWithRules(cv, [titulo])[0]!.assessment).toBe("sin_evidencia");
    // Rotulada dentro de la línea, que es la forma más común en un CV.
    const enLinea = ["Ana Ficticia Salas", "Referencias: Juan Pérez Soto, Contador Público Colegiado, jefe directo."].join("\n");
    expect(evaluateWithRules(enLinea, [titulo])[0]!.assessment).toBe("sin_evidencia");
    // Si tras las referencias vuelve una sección del candidato, esa sí cuenta.
    const conCierre = [cv, "Formación académica", "Contador Público titulado, Universidad Ficticia 2020."].join("\n");
    expect(evaluateWithRules(conCierre, [titulo])[0]!.assessment).toBe("acreditado");
  });

  it("un término de dos caracteres solo cuenta escrito como sigla", () => {
    const si = req("s", { description: "Sistemas de Información (SI)", keywords: ["SI"] });
    expect(evaluateWithRules("Si bien no manejo Excel, aprendo rápido.", [si])[0]!.assessment).toBe("sin_evidencia");
    expect(evaluateWithRules("Soporte de SI y redes en planta.", [si])[0]!.assessment).toBe("acreditado");
    // «B2» es un término corto legítimo y sigue funcionando.
    const b2 = req("b", { category: "idioma", description: "Inglés intermedio-alto (nivel B2)", keywords: ["B2"] });
    expect(evaluateWithRules("Idiomas: inglés B2, portugués básico.", [b2])[0]!.assessment).toBe("acreditado");
  });

  it("lo que hace otra persona no acredita al candidato", () => {
    const concar = req("c", { category: "herramienta", description: "Manejo de Concar", keywords: ["Concar"] });
    const sap = req("s", { category: "herramienta", description: "Manejo de SAP Business One", keywords: ["SAP Business One"] });
    const juzgar = (texto: string, requisito = concar) => evaluateWithRules(texto, [requisito])[0]!;
    expect(juzgar("Mi equipo utilizaba Concar; yo apoyaba en el archivo físico.").assessment).toBe("pendiente_verificacion");
    expect(juzgar("La empresa utiliza SAP Business One en todas sus sedes.", sap).assessment).toBe("pendiente_verificacion");
    // El candidato sigue siendo el sujeto aunque la frase nombre a terceros.
    expect(juzgar("Implementé Concar en la empresa durante el cierre 2024.").assessment).toBe("acreditado");
    expect(juzgar("Capacité al equipo contable en el uso de Concar.").assessment).toBe("acreditado");
    expect(juzgar("Reduje los errores del equipo con Concar.").assessment).toBe("acreditado");
    expect(juzgar("Mi equipo y yo implementamos Concar.").assessment).toBe("acreditado");
  });

  it("una hoja sin saltos de línea no multiplica el tiempo de un requisito de formación", () => {
    // Sin el tope de IN_PROGRESS_RADIUS, la «línea» es el CV entero y cada
    // coincidencia lo normaliza otra vez: medido, 9 veces más lento.
    const bloque =
      "Asistente contable en Comercial Ficticia SAC. Registro de comprobantes y conciliaciones. Bachiller en Contabilidad, Universidad Ficticia, 2019.";
    const partes = Array.from({ length: Math.ceil(100_000 / bloque.length) }, () => bloque);
    const conSaltos = partes.join("\n");
    const sinSaltos = partes.join(" ");
    const titulo = req("t", { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] });
    const medir = (texto: string) => {
      const inicio = performance.now();
      evaluateWithRules(texto, [titulo], { referenceDate: new Date("2026-11-03T12:00:00.000Z") });
      return performance.now() - inicio;
    };
    medir(conSaltos);
    medir(sinSaltos);
    // Criterio relativo: no depende de lo rápida que sea la máquina.
    expect(medir(sinSaltos) / Math.max(medir(conSaltos), 1)).toBeLessThan(4);
  });

  it("la pista de estudios cuenta aunque una barra separe los campos", () => {
    const titulo = req("t", { category: "formacion", description: "Título o bachiller en Contabilidad", keywords: ["Contabilidad"] });
    // Formato de plantilla: la barra corta la oración, pero la línea es la misma.
    expect(evaluateWithRules("Universidad Nacional Ficticia | Contabilidad | 2016 - 2021", [titulo])[0]!.assessment).toBe(
      "acreditado",
    );
  });

  it("encuentra el término aunque el PDF parta la palabra o deje un guion suave", () => {
    const req1 = req("c", { category: "experiencia", description: "Contabilidad general", keywords: ["contabilidad"] });
    expect(evaluateWithRules("Experiencia en contabi-\nlidad general.", [req1])[0]!.assessment).toBe("acreditado");
    expect(evaluateWithRules("Experiencia en contabi­lidad general.", [req1])[0]!.assessment).toBe("acreditado");
  });
});

describe("reglas-v4: grado académico (escalera del Perú)", () => {
  const pide = (description: string, keywords = ["Contabilidad"]) =>
    req("f", { category: "formacion", description, keywords });
  const nivel = (texto: string, description: string, keywords?: string[]) =>
    evaluateWithRules(texto, [pide(description, keywords)])[0]!;

  it("un egresado no acredita un puesto que pide título profesional", () => {
    const r = nivel("Egresado de la carrera de Contabilidad, Universidad Nacional Ficticia, 2021.", "Título profesional en Contabilidad");
    expect(r.assessment).toBe("pendiente_verificacion");
    expect(r.rationale).toContain("egresado");
    expect(r.rationale).toContain("título profesional");
  });

  it("un bachiller tampoco acredita un puesto que pide título profesional", () => {
    expect(nivel("Bachiller en Contabilidad, Universidad Nacional Ficticia, 2021.", "Título profesional en Contabilidad").assessment).toBe(
      "pendiente_verificacion",
    );
  });

  it("el grado mayor cubre al menor", () => {
    expect(nivel("Título profesional en Contabilidad, Universidad Ficticia, 2022.", "Bachiller en Contabilidad").assessment).toBe("acreditado");
    expect(nivel("Maestría en Contabilidad, Universidad Ficticia, 2024.", "Título en Contabilidad").assessment).toBe("acreditado");
  });

  it("en una disyuntiva vale el grado menor que pide la vacante", () => {
    // «Título o bachiller»: el bachiller basta, no se exige el máximo.
    expect(nivel("Bachiller en Contabilidad, Universidad Ficticia, 2021.", "Título o bachiller en Contabilidad").assessment).toBe("acreditado");
  });

  it("la secundaria no acredita un puesto que pide estudios superiores", () => {
    expect(
      nivel("Secundaria completa, Colegio Nacional Ficticio. Estudios de computación básica.", "Estudios técnicos o universitarios", ["estudios"])
        .assessment,
    ).toBe("pendiente_verificacion");
  });

  it("«Colegio de Contadores» es colegiatura, no secundaria", () => {
    expect(
      nivel("Contadora Pública Colegiada, miembro del Colegio de Contadores Públicos de Lima.", "Título o bachiller en Contabilidad", [
        "Contador",
      ]).assessment,
    ).toBe("acreditado");
  });

  it("si la vacante no nombra un grado, la escalera no interviene", () => {
    expect(nivel("Egresado de la carrera de Contabilidad, Universidad Nacional Ficticia, 2021.", "Estudios universitarios en Contabilidad").assessment).toBe(
      "acreditado",
    );
    // El diplomado sigue contando: decisión de negocio registrada en la metodología.
    expect(nivel("Diplomado en Contabilidad Gerencial (40 horas) - Instituto Ficticio.", "Título o bachiller en Contabilidad").assessment).toBe(
      "acreditado",
    );
  });
});

describe("reglas-v4: nivel de idioma por código del marco europeo", () => {
  const idioma = (description: string) => req("i", { category: "idioma", description, keywords: ["Inglés"] });
  const run = (texto: string, description = "Inglés intermedio (B2)") =>
    evaluateWithRules(texto, [idioma(description)])[0]!.assessment;

  it("un A2 no acredita un puesto que pide B2, aunque el CV no escriba «básico»", () => {
    expect(run("Idiomas: Español nativo, Inglés A2.")).toBe("pendiente_verificacion");
    expect(run("Idiomas: Inglés A1.")).toBe("pendiente_verificacion");
  });

  it("funciona aunque la descripción del requisito solo lleve el código", () => {
    expect(run("Idiomas: Inglés A2.", "Inglés B2")).toBe("pendiente_verificacion");
  });

  it("el nivel pedido o uno mayor sí acreditan", () => {
    expect(run("Idiomas: Inglés B2.")).toBe("acreditado");
    expect(run("Idiomas: Inglés C1, certificado.")).toBe("acreditado");
    expect(run("Idiomas: Inglés intermedio.")).toBe("acreditado");
  });

  it("compara los códigos como niveles: B1 no llega a B2", () => {
    expect(run("Idiomas: Inglés B1.")).toBe("pendiente_verificacion");
    expect(run("Idiomas: Inglés B1.", "Inglés B1")).toBe("acreditado");
  });

  it("en un rango pedido vale el extremo menor", () => {
    // «Inglés intermedio B1-B2»: con B1 el candidato ya entra.
    expect(run("Idiomas: Inglés B1.", "Inglés intermedio B1-B2")).toBe("acreditado");
  });

  it("no declarar el nivel no es declararlo bajo", () => {
    expect(run("Idiomas: Inglés y portugués.")).toBe("acreditado");
  });

  it("solo se aplica a requisitos de idioma: «B2B» de ventas no es un nivel", () => {
    const ventas = req("v", { category: "experiencia", description: "Ventas B2B nivel avanzado", keywords: ["B2B"] });
    expect(evaluateWithRules("Experiencia en ventas B2B y cuentas clave, nivel avanzado.", [ventas])[0]!.assessment).toBe(
      "acreditado",
    );
  });
});

describe("reglas-v4: alcance de la negación, enlaces y deseos", () => {
  const herramienta = (keywords: string[], description = keywords[0]!) =>
    req("h", { category: "herramienta", description, keywords });
  const run = (texto: string, keywords: string[], description?: string) =>
    evaluateWithRules(texto, [herramienta(keywords, description)])[0]!.assessment;

  it("la negación alcanza al término aunque haya cuatro palabras en medio", () => {
    expect(run("No cuento con experiencia en Concar, pero sí en SAP Business One.", ["Concar"])).toBe("pendiente_verificacion");
  });

  it("pero no salta a la proposición siguiente", () => {
    expect(run("No cuento con experiencia en Concar, pero sí en SAP Business One.", ["SAP Business One"])).toBe("acreditado");
    expect(run("No es un problema el cierre contable a presión, manejo Concar a diario.", ["Concar"])).toBe("acreditado");
  });

  it("«y» no corta la negación: niega los dos términos", () => {
    expect(run("No manejo Concar y Excel.", ["Concar"])).toBe("pendiente_verificacion");
    expect(run("No manejo Concar y Excel.", ["Excel"])).toBe("pendiente_verificacion");
  });

  it("un término dentro de un correo o un enlace no acredita", () => {
    expect(run("Luis Ficticio. Correo: sap@miempresa.com", ["SAP"])).toBe("pendiente_verificacion");
    expect(run("Perfil: https://www.concar.com.pe/mi-perfil", ["Concar"])).toBe("pendiente_verificacion");
  });

  it("el filtro de enlaces no alcanza al resto del CV ni al punto final", () => {
    expect(run("Correo: luis@miempresa.com\nHerramientas: Concar, Excel y SAP.", ["Concar"])).toBe("acreditado");
    expect(run("Herramientas contables: Concar, Excel y SAP.", ["SAP"])).toBe("acreditado");
  });

  it("la negación cruza el corte de línea del PDF", () => {
    // Formato exacto que devuelve pdf.js: la prosa se parte por el ancho de la
    // hoja y «No cuento» queda en la línea anterior al término.
    const cv = [
      "Asistente administrativa con 3 años de experiencia en soporte de oficina y atención al personal. No cuento",
      "con experiencia en planillas ni en PLAME, pero sí en el manejo de legajos y documentación del personal.",
    ].join("\n");
    expect(run(cv, ["planillas"])).toBe("pendiente_verificacion");
    expect(run(cv, ["PLAME"])).toBe("pendiente_verificacion");
    // Lo que sí tiene, en la proposición afirmativa, sigue acreditando.
    expect(run(cv, ["legajos"])).toBe("acreditado");
  });

  it("una entrada nueva sí corta: no arrastra la negación hacia abajo", () => {
    // La línea siguiente empieza en mayúscula, así que es otra entrada.
    const cv = ["No manejo sistemas contables.", "Concar a nivel avanzado desde 2019."].join("\n");
    expect(run(cv, ["Concar"])).toBe("acreditado");
  });

  it("un curso que piensa tomar no acredita, pero mejorar lo que ya usa sí", () => {
    expect(run("Intereses: ajedrez y cursos de Concar que planeo tomar.", ["Concar"])).toBe("pendiente_verificacion");
    expect(run("Manejo Excel avanzado, que quiero perfeccionar con un curso de macros.", ["Excel"], "Excel avanzado")).toBe("acreditado");
  });
});

describe("equivalencias de evidencia (reglas-v5)", () => {
  const ref = new Date("2026-11-13");
  const requirement = (overrides: Partial<RequirementInput>): RequirementInput => ({
    id: "1",
    category: "habilidad_tecnica",
    priority: "obligatorio",
    description: "Contabilidad",
    keywords: ["contabilidad"],
    weight: 5,
    minYears: null,
    isEssential: false,
    ...overrides,
  });
  const run = (texto: string, r: RequirementInput) => evaluateRequirement(texto, normalizeForSearch(texto), r, ref);

  it("acredita por equivalencia y lo marca en el rationale", () => {
    const r = evaluateRequirement(
      "Responsable de los libros contables de la empresa durante 2020-2023.",
      normalizeForSearch("Responsable de los libros contables de la empresa durante 2020-2023."),
      { id: "1", category: "habilidad_tecnica", priority: "obligatorio", description: "Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: false },
      new Date("2026-11-13"),
    );
    expect(r.assessment).toBe("acreditado");
    expect(r.rationale.toLowerCase()).toContain("equivalencia");
  });

  it("no aplica equivalencias a formación", () => {
    const texto = "Experiencia en libros contables.";
    const r = evaluateRequirement(texto, normalizeForSearch(texto),
      { id: "1", category: "formacion", priority: "obligatorio", description: "Título en Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: false },
      new Date("2026-11-13"));
    expect(r.assessment).toBe("sin_evidencia");
  });

  it("la equivalencia dentro de una mención de tercero no acredita", () => {
    const texto = "Mi equipo llevaba los libros contables; yo coordinaba compras.";
    const r = evaluateRequirement(texto, normalizeForSearch(texto),
      { id: "1", category: "habilidad_tecnica", priority: "obligatorio", description: "Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: false },
      new Date("2026-11-13"));
    expect(r.assessment).not.toBe("acreditado");
    expect(["pendiente_verificacion", "sin_evidencia"]).toContain(r.assessment);
  });

  it("un esencial cubierto solo por equivalencia queda pendiente", () => {
    const texto = "Encargada de los libros contables.";
    const r = evaluateRequirement(texto, normalizeForSearch(texto),
      { id: "1", category: "habilidad_tecnica", priority: "obligatorio", description: "Contabilidad", keywords: ["contabilidad"], weight: 5, minYears: null, isEssential: true },
      new Date("2026-11-13"));
    expect(r.assessment).toBe("pendiente_verificacion");
    expect(r.rationale.toLowerCase()).toContain("equivalencia");
  });

  it("RULE_ENGINE_VERSION es reglas-v7", () => {
    expect(RULE_ENGINE_VERSION).toBe("reglas-v7");
  });

  it("un término corto equivalente no acredita dentro de una palabra que lo contiene", () => {
    const r = requirement({ description: "Tecnologías de la información", keywords: ["tecnologías de la información"] });
    expect(run("Gestión administrativa, actividades y estimación de costos; dije ti.", r).assessment).toBe("sin_evidencia");
    expect(run("Soporte en el área de TI de la empresa.", r).assessment).toBe("acreditado");
  });

  it("término directo y equivalente sobre el mismo fragmento cuentan una sola evidencia", () => {
    const texto = "Trabajé en contabilidad general.";
    const r = run(texto, requirement({ keywords: ["contabilidad", "contabilidad general"] }));
    expect(r.assessment).toBe("acreditado");
    expect(r.evidence).toHaveLength(1);
    expect(r.rationale).not.toContain("equivalencia");
  });
});
