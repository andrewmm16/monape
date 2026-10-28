import { describe, expect, it } from "vitest";
import { vacancyFormSchema, type VacancyFormInput } from "@/modules/vacancies/schemas";

const base: VacancyFormInput = {
  title: "Analista de datos",
  department: "Operaciones",
  description: "",
  responsibilities: "",
  location: "",
  modality: "",
  contractType: "",
  openingDate: "",
  closingDate: "",
  ownerId: "",
  city: "",
  region: "",
  employmentType: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "",
  salaryPeriod: "",
  isConfidential: false,
};

const parse = (overrides: Partial<VacancyFormInput>) => vacancyFormSchema.safeParse({ ...base, ...overrides });
const withSalary = { salaryCurrency: "PEN", salaryPeriod: "mes" } as const;

function failedPaths(result: ReturnType<typeof parse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("sueldo del formulario de vacante", () => {
  it.each([
    ["3000", 3000],
    ["3000,50", 3000.5],
    ["3000.5", 3000.5],
  ])("acepta el monto %s", (text, expected) => {
    const result = parse({ salaryMin: text, ...withSalary });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.salaryMin).toBe(expected);
  });

  it("sin sueldo es válido y no guarda moneda ni periodo", () => {
    const result = parse({ salaryCurrency: "USD", salaryPeriod: "hora" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null });
    }
  });

  it.each(["abc", "ddd", "-5", "1e3"])("rechaza el monto %s", (text) => {
    expect(failedPaths(parse({ salaryMin: text, ...withSalary }))).toContain("salaryMin");
  });

  it("rechaza solo el máximo", () => {
    expect(failedPaths(parse({ salaryMax: "4000", ...withSalary }))).toContain("salaryMin");
  });

  it("rechaza máximo menor que el mínimo y acepta rango y mínimo igual al máximo", () => {
    expect(failedPaths(parse({ salaryMin: "5000", salaryMax: "4000", ...withSalary }))).toContain("salaryMax");
    expect(parse({ salaryMin: "4000", salaryMax: "5000", ...withSalary }).success).toBe(true);
    expect(parse({ salaryMin: "4000", salaryMax: "4000", ...withSalary }).success).toBe(true);
  });

  it("exige moneda y periodo cuando hay sueldo", () => {
    const missingCurrency = failedPaths(parse({ salaryMin: "3000", salaryPeriod: "mes" }));
    expect(missingCurrency).toContain("salaryCurrency");
    expect(missingCurrency).not.toContain("salaryPeriod");
    const missingPeriod = failedPaths(parse({ salaryMin: "3000", salaryCurrency: "PEN" }));
    expect(missingPeriod).toContain("salaryPeriod");
    expect(missingPeriod).not.toContain("salaryCurrency");
  });
});

describe("datos de publicación del formulario", () => {
  it("una vacante confidencial sin ciudad ni región es válida (la base de datos decide al publicar)", () => {
    const result = parse({ isConfidential: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ city: null, region: null, isConfidential: true });
  });

  it("limita ciudad y región a 100 caracteres y valida el tipo de empleo", () => {
    expect(failedPaths(parse({ city: "x".repeat(101) }))).toContain("city");
    expect(parse({ employmentType: "practicas" }).success).toBe(true);
    expect(parse({ employmentType: "otro" as never }).success).toBe(false);
  });
});
