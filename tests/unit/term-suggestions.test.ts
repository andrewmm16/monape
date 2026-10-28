import { describe, expect, it } from "vitest";
import { appendTerms, MAX_KEYWORDS, MAX_KEYWORDS_LENGTH, splitKeywords, suggestTerms, TERM_GROUPS } from "@/modules/vacancies/term-suggestions";

describe("sugerencia de términos relacionados", () => {
  it("se activa por la descripción del requisito", () => {
    expect(suggestTerms("Manejo de Power BI", [])).toEqual(["Power BI", "DAX", "Power Query", "Power Pivot"]);
  });

  it("se activa por los términos ya escritos", () => {
    expect(suggestTerms("Requisito sin palabras clave", ["MySQL"])).toEqual([
      "SQL",
      "SQL Server",
      "PostgreSQL",
      "Oracle",
      "T-SQL",
      "PL/SQL",
      "consultas SQL",
    ]);
  });

  it("ignora tildes y mayúsculas al activar y al comparar", () => {
    const result = suggestTerms("INGLES intermedio", ["toefl", "Ingles"]);
    expect(result).toContain("English");
    expect(result).toContain("IELTS");
    expect(result).not.toContain("TOEFL");
    expect(result).not.toContain("inglés");
    expect(suggestTerms("Nomina y planillas", [])).toContain("PLAME");
    expect(suggestTerms("Conocimientos de TRIBUTACION", ["Sunat"])).not.toContain("SUNAT");
  });

  it("no repite los términos que ya están ni los duplicados entre grupos", () => {
    const result = suggestTerms("Excel y Power BI", ["Excel", "Power Query"]);
    expect(result).not.toContain("Excel");
    expect(result.filter((term) => term === "Power Query")).toHaveLength(0);
    expect(new Set(result.map((t) => t.toLowerCase())).size).toBe(result.length);
    // «Power Pivot» está en dos grupos y se sugiere una sola vez.
    expect(suggestTerms("Excel y Power BI", []).filter((term) => term === "Power Pivot")).toHaveLength(1);
  });

  it("respeta el orden del diccionario y el máximo", () => {
    expect(suggestTerms("Excel", [])).toEqual([
      "Excel",
      "Excel avanzado",
      "tablas dinámicas",
      "macros",
      "VBA",
      "Power Query",
      "Power Pivot",
      "BUSCARV",
    ]);
    expect(suggestTerms("Excel", [], 3)).toEqual(["Excel", "Excel avanzado", "tablas dinámicas"]);
    expect(suggestTerms("Excel", [], 0)).toEqual([]);
    const many = suggestTerms("Excel, SQL, Python, Contabilidad, Ventas", []);
    expect(many).toHaveLength(8);
  });

  it("no produce falsos positivos dentro de otra palabra", () => {
    expect(suggestTerms("Experiencia con NoSQL y mysqlx", [])).toEqual([]);
    expect(suggestTerms("Conocimiento de Javascripting", [])).toEqual([]);
    expect(suggestTerms("Trabajo con sapiencia y excelente trato", [])).toEqual([]);
    expect(suggestTerms("Derechos humanos", [])).toEqual([]);
  });

  it("reconoce términos con símbolos", () => {
    expect(suggestTerms("Desarrollo en C#", [])).toContain("ASP.NET");
    expect(suggestTerms("Backend con .NET", [])).toContain("C#");
  });

  it("devuelve una lista vacía si no hay coincidencias", () => {
    expect(suggestTerms("Trato amable", [])).toEqual([]);
    expect(suggestTerms("", [])).toEqual([]);
  });

  it("el diccionario no contiene términos repetidos dentro de un grupo", () => {
    for (const group of TERM_GROUPS) {
      expect(new Set(group.terms.map((t) => t.toLowerCase())).size).toBe(group.terms.length);
    }
  });
});

describe("agregar términos al campo", () => {
  it("usa el formato separado por comas y no repite", () => {
    expect(appendTerms("SQL", ["SQL Server", "sql"])).toEqual({ value: "SQL, SQL Server", added: ["SQL Server"] });
    expect(appendTerms("", ["Excel"])).toEqual({ value: "Excel", added: ["Excel"] });
  });

  it("no supera los 20 términos", () => {
    const current = Array.from({ length: 18 }, (_, i) => `t${i}`).join(", ");
    const result = appendTerms(current, ["a", "b", "c", "d"]);
    expect(result.added).toEqual(["a", "b"]);
    expect(splitKeywords(result.value)).toHaveLength(MAX_KEYWORDS);
    expect(appendTerms(result.value, ["z"]).added).toEqual([]);
  });

  it("no supera los 1000 caracteres", () => {
    const long = Array.from({ length: 9 }, (_, i) => `${"x".repeat(100)}${i}`).join(", ");
    const result = appendTerms(long, ["y".repeat(60), "z".repeat(40), "corto"]);
    expect(result.value.length).toBeLessThanOrEqual(MAX_KEYWORDS_LENGTH);
    expect(result.added.at(-1)).toBe("corto");
  });
});
