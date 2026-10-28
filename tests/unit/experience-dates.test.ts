import { describe, expect, it } from "vitest";
import { estimateExperienceFromDates, parsePeriods } from "@/modules/evaluation/experience-dates";

// Fecha de referencia fija: junio de 2026.
const REF = new Date("2026-06-15T12:00:00Z");

function months(text: string, terms: string[]) {
  const result = estimateExperienceFromDates(text, terms, REF);
  return result && { min: result.minYears * 12, max: result.maxYears * 12 };
}

function section(...lines: string[]) {
  return ["Juan Ficticio Pérez", "Experiencia laboral", ...lines].join("\n");
}

describe("diseños de CV", () => {
  it("fecha en la misma línea que el cargo", () => {
    const cv = section(
      "Analista de Datos - Empresa Uno | 03/2019 - 12/2022",
      "Reportes en Excel y tableros",
      "Formación académica",
      "Bachiller en Ingeniería",
    );
    expect(months(cv, ["Excel"])).toEqual({ min: 46, max: 46 });
  });

  it("cargo y empresa arriba, fecha debajo", () => {
    const cv = section("Analista de Datos", "Empresa Uno", "Marzo 2019 - Diciembre 2022", "Elaboración de reportes en Excel");
    expect(months(cv, ["Excel"])).toEqual({ min: 46, max: 46 });
  });

  it("términos solo en el cargo (arriba de la fecha)", () => {
    const cv = section("Analista de Excel", "Empresa Uno", "03/2019 - 12/2019", "Funciones varias");
    expect(months(cv, ["Excel"])).toEqual({ min: 10, max: 10 });
  });

  it("descripción con viñetas debajo", () => {
    const cv = section("Analista", "Empresa Uno", "01/2020 - 12/2020", "- Automatización de reportes", "- Uso diario de Power BI", "- Capacitación al equipo");
    expect(months(cv, ["Power BI"])).toEqual({ min: 12, max: 12 });
  });

  it("dos empleos: no atribuye las fechas de la entrada que no menciona los términos", () => {
    const cv = section(
      "Asistente Administrativo",
      "Empresa Uno",
      "01/2015 - 12/2016",
      "- Atención de clientes",
      "- Archivo",
      "- Caja",
      "Analista de Datos",
      "Empresa Dos",
      "01/2017 - 12/2018",
      "- Excel avanzado",
    );
    expect(months(cv, ["Excel"])).toEqual({ min: 24, max: 24 });
    expect(months(cv, ["Atención de clientes"])).toEqual({ min: 24, max: 24 });
  });

  it("tres empleos: suma solo los que mencionan los términos", () => {
    const cv = section(
      "Analista Junior",
      "Empresa Uno",
      "01/2012 - 12/2012",
      "- Excel",
      "- Reportes",
      "- Archivo",
      "Asistente",
      "Empresa Dos",
      "01/2013 - 12/2014",
      "- Caja",
      "- Atención",
      "- Archivo",
      "Analista Senior",
      "Empresa Tres",
      "01/2015 - 06/2016",
      "- Excel y SQL",
    );
    expect(months(cv, ["Excel"])).toEqual({ min: 30, max: 30 });
    expect(months(cv, ["Excel", "Caja"])).toEqual({ min: 54, max: 54 });
  });
});

describe("formatos de fecha", () => {
  const cases: Array<[string, number]> = [
    ["03/2019 - 12/2022", 46],
    ["05-2018 - 04-2019", 12],
    ["05.2018 - 04.2019", 12],
    ["Marzo 2019 – Diciembre 2022", 46],
    ["Setiembre de 2018 a Diciembre del 2019", 16],
    ["set. 2018 - dic. 2019", 16],
    ["Sept 2018 - Dec 2019", 16],
    ["March 2019 to December 2022", 46],
    ["Desde enero 2020 hasta junio 2020", 6],
    ["From Feb 2021 until Apr 2021", 3],
    ["Ene 2020 — Mar 2020", 3],
    ["Jan 2020 - Present", 78],
    ["Marzo 2025 a la actualidad", 16],
    ["01/2026 - actual", 6],
    ["Octubre 2025 - la fecha", 9],
    ["Enero 2026 al presente", 6],
    ["Mayo 2026 - hoy", 2],
    ["Mar 2025 - Current", 16],
    ["Abril 2026 - now", 3],
    ["De marzo 2019 a marzo 2020", 13],
  ];

  it.each(cases)("%s", (range, expected) => {
    const cv = section("Analista con Excel", range);
    expect(months(cv, ["Excel"])).toEqual({ min: expected, max: expected });
  });

  it("entiende «a la fecha» como periodo en curso", () => {
    expect(months(section("Analista con Excel", "2026 a la fecha"), ["Excel"])).toEqual({ min: 1, max: 6 });
  });
});

describe("año solo: cotas mínima y máxima", () => {
  it("2019 - 2022: mínimo dic-2019 a ene-2022 y máximo ene-2019 a dic-2022", () => {
    expect(months(section("Analista con Excel", "2019 - 2022"), ["Excel"])).toEqual({ min: 26, max: 48 });
  });

  it("el mínimo nunca baja de 1 mes", () => {
    expect(months(section("Analista con Excel", "2019 - 2019"), ["Excel"])).toEqual({ min: 1, max: 12 });
  });

  it("mezcla mes exacto y año", () => {
    // Mar/2019 a 2020: mínimo mar-2019..ene-2020 (11), máximo mar-2019..dic-2020 (22).
    expect(months(section("Analista con Excel", "03/2019 - 2020"), ["Excel"])).toEqual({ min: 11, max: 22 });
  });

  it("un fin en un año futuro se recorta a la fecha de referencia", () => {
    // 2026 - 2027: máximo ene-2026..jun-2026 (6); mínimo 1 mes (jun-2026).
    expect(months(section("Analista con Excel", "2026 - 2027"), ["Excel"])).toEqual({ min: 1, max: 6 });
  });

  it("«actual» equivale al mes de la fecha de referencia", () => {
    const result = estimateExperienceFromDates(section("Analista con Excel", "06/2026 - actualidad"), ["Excel"], REF);
    expect(result!.minYears * 12).toBe(1);
  });
});

describe("solapamientos", () => {
  it("une periodos solapados sin contarlos dos veces", () => {
    const cv = section(
      "Analista Excel",
      "Empresa Uno",
      "01/2018 - 12/2019",
      "- Reportes",
      "- Tableros",
      "- Archivo",
      "Consultor Excel",
      "Empresa Dos",
      "07/2019 - 06/2020",
      "- Reportes",
    );
    expect(months(cv, ["Excel"])).toEqual({ min: 30, max: 30 });
  });

  it("une las cotas por separado", () => {
    const cv = section("Analista Excel", "Empresa Uno", "2018 - 2019", "- a", "- b", "- c", "Consultor Excel", "Empresa Dos", "2019 - 2020", "- Reportes");
    // máximo: ene-2018..dic-2020 = 36; mínimo: [dic-2018..ene-2019] + [dic-2019..ene-2020] = 2 + 2.
    expect(months(cv, ["Excel"])).toEqual({ min: 4, max: 36 });
  });
});

describe("secciones", () => {
  it("las fechas de estudios fuera de la sección de experiencia no cuentan", () => {
    const cv = [
      "Juan Ficticio",
      "Experiencia laboral",
      "Analista con Excel",
      "01/2020 - 12/2020",
      "Formación académica",
      "Curso de Excel avanzado",
      "01/2010 - 12/2015",
      "Idiomas",
      "Inglés 2000 - 2005 Excel",
    ].join("\n");
    expect(months(cv, ["Excel"])).toEqual({ min: 12, max: 12 });
  });

  it("sin encabezado de experiencia no hay periodos", () => {
    const cv = ["Juan Ficticio", "Analista con Excel", "01/2020 - 12/2020", "Formación académica", "Excel 2010 - 2015"].join("\n");
    expect(estimateExperienceFromDates(cv, ["Excel"], REF)).toBeNull();
  });

  it("solo estudios: sin periodos aunque haya fechas y el término aparezca", () => {
    const cv = ["Educación", "Ingeniería Industrial, curso de Excel", "2012 - 2017"].join("\n");
    expect(estimateExperienceFromDates(cv, ["Excel"], REF)).toBeNull();
  });

  it("acepta encabezados en inglés y con signos", () => {
    const cv = ["WORK EXPERIENCE:", "Analyst using Excel", "Jan 2020 - Dec 2020", "EDUCATION", "BSc 2010 - 2014 Excel"].join("\n");
    expect(months(cv, ["Excel"])).toEqual({ min: 12, max: 12 });
  });

  it("una línea corta que no es encabezado conocido no abre ni cierra la sección", () => {
    const cv = ["Experiencia laboral", "Experiencia en ventas", "Vendedor de Excel", "01/2020 - 12/2020", "Referencias", "Excel 2001 - 2005"].join("\n");
    expect(months(cv, ["Excel"])).toEqual({ min: 12, max: 12 });
  });

  it("ignora líneas en blanco al contar posiciones", () => {
    const cv = "Experiencia laboral\n\nAnalista\n\nEmpresa Uno\n\n03/2019 - 12/2019\n\n- Excel\n\n";
    expect(months(cv, ["Excel"])).toEqual({ min: 10, max: 10 });
  });
});

describe("rangos inválidos", () => {
  const invalid = ["12/2022 - 03/2019", "1940 - 1945", "2030 - 2031", "01/1960 - actualidad", "Marzo 2022 - Marzo 2021"];
  it.each(invalid)("descarta %s", (range) => {
    expect(parsePeriods(range.toLowerCase(), REF)).toEqual([]);
    expect(estimateExperienceFromDates(section("Analista con Excel", range), ["Excel"], REF)).toBeNull();
  });

  it("no toma números sueltos como fechas", () => {
    expect(parsePeriods("tel 987654321 - ruc 20123456789", REF)).toEqual([]);
  });
});

describe("términos y evidencia", () => {
  it("respeta los límites de palabra", () => {
    expect(estimateExperienceFromDates(section("Analista de NoSQL", "01/2020 - 12/2020"), ["SQL"], REF)).toBeNull();
  });

  it("devuelve null si ninguna entrada menciona los términos", () => {
    expect(estimateExperienceFromDates(section("Cajero", "01/2020 - 12/2020"), ["Excel"], REF)).toBeNull();
  });

  it("las citas son líneas literales del CV con su posición, máximo 3", () => {
    const cv = section(
      "Excel 1",
      "01/2010 - 12/2010",
      "- a",
      "- b",
      "- c",
      "Excel 2",
      "  01/2011 - 12/2011  ",
      "- a",
      "- b",
      "- c",
      "Excel 3",
      "01/2012 - 12/2012",
      "- a",
      "- b",
      "- c",
      "Excel 4",
      "01/2013 - 12/2013",
    );
    const result = estimateExperienceFromDates(cv, ["Excel"], REF)!;
    expect(result.quotes.map((q) => q.quote)).toEqual(["01/2010 - 12/2010", "01/2011 - 12/2011", "01/2012 - 12/2012"]);
    for (const { quote, start, end } of result.quotes) expect(cv.slice(start, end)).toBe(quote);
  });

  it("es determinista para la misma fecha de referencia", () => {
    const cv = section("Analista con Excel", "Jan 2020 - Present");
    expect(estimateExperienceFromDates(cv, ["Excel"], REF)).toEqual(estimateExperienceFromDates(cv, ["Excel"], REF));
  });
});

describe("secciones que cierran la de experiencia", () => {
  const closing = [
    "Formación profesional",
    "Estudios realizados",
    "Educación y formación",
    "Estudios superiores",
    "Información académica",
    "Proyectos",
    "Tecnologías",
    "Logros",
    "Otros datos",
    "Voluntariado",
    "Publicaciones",
    "Premios",
    "Intereses",
    "Herramientas",
    "Software",
    "Informática",
    "Conocimientos técnicos",
    "Información adicional",
    "Otros estudios",
    "Especializaciones",
    "Diplomados",
    "Posgrado",
    "Maestría",
    // por prefijo (fuertes) o encabezado ambiguo aislado
    "Estudios universitarios y técnicos",
    "Cursos y talleres realizados",
    "Certificación PMP vigente",
    "Idiomas y tecnologías",
    "Otros conocimientos y logros",
    "Diplomado en Gestión Pública",
    "Maestría en Finanzas",
    "Datos adicionales",
    "Información complementaria",
    "Proyectos destacados",
    "Habilidades:",
    "Idiomas:",
    "Skills",
    "Education:",
  ];

  it.each(closing)("«%s» cierra la sección", (heading) => {
    const cv = section("Analista Python", "01/2020 - 12/2020", heading, "Python básico", "2000 - 2020");
    expect(months(cv, ["Python"])).toEqual({ min: 12, max: 12 });
  });

  it("el caso de «Estudios realizados» no suma 19 años", () => {
    const cv = ["Experiencia laboral", "Analista Python", "01/2020 - 12/2020", "Estudios realizados", "Python básico", "2000 - 2020"].join("\n");
    expect(months(cv, ["Python"])).toEqual({ min: 12, max: 12 });
  });

  it("cierra también sin encabezado de experiencia previo: no hay periodos", () => {
    expect(estimateExperienceFromDates(["Estudios realizados", "Python básico", "2000 - 2020"].join("\n"), ["Python"], REF)).toBeNull();
  });

  it("un cargo en mayúsculas o un título corto sin cierre no cierra la sección", () => {
    const cv = section("ANALISTA SENIOR DE PYTHON", "EMPRESA UNO", "01/2020 - 12/2020", "ANALISTA JUNIOR", "Empresa Dos", "01/2021 - 12/2021", "- Python");
    expect(months(cv, ["Python"])).toEqual({ min: 24, max: 24 });
  });

  it("un encabezado de experiencia no se confunde con uno de cierre", () => {
    const cv = ["Experiencia", "Analista Python", "01/2020 - 12/2020", "Educación", "Curso", "Experiencia profesional", "Consultor Python", "01/2021 - 06/2021"].join("\n");
    expect(months(cv, ["Python"])).toEqual({ min: 18, max: 18 });
  });
});

describe("límite de las entradas", () => {
  it("un bloque posterior sin encabezado reconocido no se atribuye al último cargo", () => {
    const cv = section(
      "Analista",
      "Empresa Uno",
      "01/2020 - 12/2020",
      "- Reportes",
      "Habilidades: Python, Django, Flask, Pandas, NumPy, SQL, Docker",
    );
    expect(estimateExperienceFromDates(cv, ["Python"], REF)).toBeNull();
    expect(months(cv, ["Reportes"])).toEqual({ min: 12, max: 12 });
  });

  it("una entrada abarca como máximo 12 líneas después de la fecha", () => {
    const filler = (count: number) => Array.from({ length: count }, (_, i) => `- tarea ${i + 1}`);
    const inside = section("Analista", "Empresa", "01/2020 - 12/2020", ...filler(11), "- Python");
    const outside = section("Analista", "Empresa", "01/2020 - 12/2020", ...filler(12), "- Python");
    expect(months(inside, ["Python"])).toEqual({ min: 12, max: 12 });
    expect(estimateExperienceFromDates(outside, ["Python"], REF)).toBeNull();
  });
});

describe("fechas con día", () => {
  const cases: Array<[string, number]> = [
    ["15/03/2019 - 20/12/2022", 46],
    ["15-03-2019 al 31-12-2022", 46],
    ["01.03.2019 - 31.12.2022", 46],
    ["Desde 01/01/2020 hasta 30/06/2020", 6],
    ["03/2019 - 31/12/2022", 46],
    ["15/03/2019 - actualidad", 88],
  ];
  it.each(cases)("%s", (range, expected) => {
    expect(months(section("Analista con Excel", range), ["Excel"])).toEqual({ min: expected, max: expected });
  });
});

describe("números que parecen fechas", () => {
  it.each(["tel 987-2019 - 2025 ext", "cel: 01-2000 al 12-2020", "2019-2020-0045", "ruc 20-2019 - 2020", "45/03/2019 - 12/2020"])(
    "no lee «%s» como periodo",
    (text) => {
      expect(parsePeriods(text, REF)).toEqual([]);
    },
  );

  it("sigue leyendo rangos legítimos pegados al guion", () => {
    expect(parsePeriods("2019-2020", REF)).toHaveLength(1);
    expect(parsePeriods("analista (2019 - 2020) empresa", REF)).toHaveLength(1);
    expect(parsePeriods("lima. 2019 - 2020", REF)).toHaveLength(1);
  });

  it("no cuenta un teléfono dentro de la sección de experiencia", () => {
    expect(estimateExperienceFromDates(section("Analista con Excel", "Cel: 01-2000 al 12-2020"), ["Excel"], REF)).toBeNull();
  });
});

describe("subtítulos dentro de un empleo y encabezados ambiguos", () => {
  it("tres empleos con «Funciones:», «Logros:» y «Herramientas: …» cuentan los tres periodos y atribuyen SAP solo a su empleo", () => {
    const cv = section(
      "Analista Contable",
      "Empresa Uno",
      "01/2015 - 12/2016",
      "Funciones:",
      "- Conciliaciones",
      "- Reportes",
      "Asistente Contable",
      "Empresa Dos",
      "01/2017 - 12/2018",
      "Responsabilidades:",
      "- Cierre mensual",
      "Logros:",
      "- Reducción de errores",
      "Contador Senior",
      "Empresa Tres",
      "01/2019 - 12/2020",
      "Funciones:",
      "- Estados financieros",
      "Herramientas: SAP, Excel",
    );
    expect(months(cv, ["Empresa"])).toEqual({ min: 72, max: 72 });
    expect(months(cv, ["Funciones"])).toEqual({ min: 48, max: 48 });
    expect(months(cv, ["Reducción de errores"])).toEqual({ min: 24, max: 24 });
    expect(months(cv, ["SAP"])).toEqual({ min: 24, max: 24 });
    expect(months(cv, ["Excel"])).toEqual({ min: 24, max: 24 });
  });

  it("«Tecnologías: React, Node» dentro del empleo acredita React con ese periodo", () => {
    const cv = section(
      "Desarrollador Frontend",
      "Empresa TI",
      "03/2019 - 02/2022",
      "Principales funciones:",
      "- Desarrollo de interfaces",
      "Tecnologías: React, Node",
      "Desarrollador Backend",
      "Empresa Dos",
      "03/2022 - 02/2023",
      "- Servicios en Java",
    );
    expect(months(cv, ["React"])).toEqual({ min: 36, max: 36 });
    expect(months(cv, ["Java"])).toEqual({ min: 12, max: 12 });
  });

  it("una sección aislada «PROYECTOS» (sin «:») después de la experiencia no cuenta", () => {
    const cv = ["Experiencia laboral", "Analista", "01/2020 - 12/2020", "- Reportes", "PROYECTOS", "Proyecto académico Python 2018 - 2020"].join("\n");
    expect(estimateExperienceFromDates(cv, ["Python"], REF)).toBeNull();
    expect(months(cv, ["Reportes"])).toEqual({ min: 12, max: 12 });
  });

  it("«Logros:», «Herramientas: …», «Funciones:» no cierran la sección ni cortan la entrada", () => {
    const cv = section("Analista", "01/2020 - 12/2020", "Funciones:", "Logros:", "Herramientas: SAP", "Proyectos: migración a Python");
    expect(months(cv, ["Python"])).toEqual({ min: 12, max: 12 });
  });

  it("un encabezado fuerte con contenido («Habilidades: …») corta la entrada", () => {
    const cv = section("Analista", "01/2020 - 12/2020", "- Reportes", "Habilidades: Python, trabajo en equipo, comunicación, liderazgo");
    expect(estimateExperienceFromDates(cv, ["Python"], REF)).toBeNull();
  });
});
