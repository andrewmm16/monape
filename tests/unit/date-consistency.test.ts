import { describe, it, expect } from "vitest";
import { buildExperienceIndex } from "@/modules/evaluation/experience-dates";
import { findDateOverlaps, describeDateOverlaps } from "@/modules/evaluation/date-consistency";

const REF = new Date(Date.UTC(2026, 10, 14)); // 2026-11-14, determinista

function overlapsOf(cv: string) {
  return findDateOverlaps(buildExperienceIndex(cv, REF));
}

describe("findDateOverlaps", () => {
  it("marca dos empleos cuyos meses se solapan", () => {
    const cv = [
      "Experiencia laboral",
      "Analista de datos - Alfa S.A.",
      "enero 2019 - diciembre 2021",
      "Consultor - Beta S.A.",
      "marzo 2020 - junio 2022",
    ].join("\n");
    const overlaps = overlapsOf(cv);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.months).toBeGreaterThanOrEqual(2);
    expect(overlaps[0]!.first.quote).toContain("2019");
    expect(overlaps[0]!.second.quote).toContain("2022");
  });

  it("no marca empleos secuenciales con meses (no se pisan)", () => {
    const cv = [
      "Experiencia laboral",
      "Cajero - Alfa",
      "enero 2018 - junio 2019",
      "Supervisor - Beta",
      "julio 2019 - diciembre 2020",
    ].join("\n");
    expect(overlapsOf(cv)).toEqual([]);
  });

  it("no marca empleos secuenciales que solo comparten el año de transición (año sin mes)", () => {
    const cv = [
      "Experiencia laboral",
      "Asistente - Alfa",
      "2015 - 2019",
      "Coordinador - Beta",
      "2019 - 2022",
    ].join("\n");
    expect(overlapsOf(cv)).toEqual([]);
  });

  it("no marca un CV con un solo empleo", () => {
    const cv = ["Experiencia laboral", "Analista - Alfa", "enero 2019 - diciembre 2021"].join("\n");
    expect(overlapsOf(cv)).toEqual([]);
  });
});

describe("describeDateOverlaps", () => {
  it("redacta una nota neutra, con ambas fechas y sin juzgar al candidato", () => {
    const cv = [
      "Experiencia laboral",
      "Analista - Alfa S.A.",
      "enero 2019 - diciembre 2021",
      "Consultor - Beta S.A.",
      "marzo 2020 - junio 2022",
    ].join("\n");
    const notes = describeDateOverlaps(findDateOverlaps(buildExperienceIndex(cv, REF)));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("enero 2019 - diciembre 2021");
    expect(notes[0]).toContain("marzo 2020 - junio 2022");
    expect(notes[0]!.toLowerCase()).toContain("entrevista");
  });

  it("devuelve lista vacía cuando no hay solapamientos", () => {
    expect(describeDateOverlaps([])).toEqual([]);
  });
});
