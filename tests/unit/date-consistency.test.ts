import { describe, it, expect } from "vitest";
import { buildExperienceIndex, findImpossibleDateRanges } from "@/modules/evaluation/experience-dates";
import {
  findDateOverlaps,
  describeDateOverlaps,
  describeImpossibleRanges,
  countShortTenures,
  describeJobHopping,
} from "@/modules/evaluation/date-consistency";

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

function impossibleOf(cv: string) {
  return findImpossibleDateRanges(cv, REF);
}

describe("findImpossibleDateRanges", () => {
  it("marca un rango cuyo fin es anterior al inicio", () => {
    const cv = ["Experiencia laboral", "Analista - Alfa", "2021 - 2018"].join("\n");
    const found = impossibleOf(cv);
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe("fin_antes_inicio");
    expect(found[0]!.quote).toContain("2021 - 2018");
  });

  it("marca un rango que empieza en el futuro", () => {
    const cv = ["Experiencia laboral", "Consultor - Beta", "enero 2030 - diciembre 2031"].join("\n");
    const found = impossibleOf(cv);
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe("inicio_futuro");
  });

  it("no marca un rango válido", () => {
    const cv = ["Experiencia laboral", "Analista - Alfa", "enero 2019 - diciembre 2021"].join("\n");
    expect(impossibleOf(cv)).toEqual([]);
  });

  it("solo mira la sección de experiencia (ignora fechas de otras secciones)", () => {
    const cv = [
      "Experiencia laboral",
      "Analista - Alfa",
      "enero 2019 - diciembre 2021",
      "Cursos",
      "Excel avanzado",
      "2022 - 2020",
    ].join("\n");
    expect(impossibleOf(cv)).toEqual([]);
  });
});

describe("describeImpossibleRanges", () => {
  it("redacta una nota neutra que invita a verificar en la entrevista", () => {
    const cv = ["Experiencia laboral", "Analista - Alfa", "2021 - 2018"].join("\n");
    const notes = describeImpossibleRanges(findImpossibleDateRanges(cv, REF));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("2021 - 2018");
    expect(notes[0]!.toLowerCase()).toContain("entrevista");
  });

  it("devuelve lista vacía sin rangos imposibles", () => {
    expect(describeImpossibleRanges([])).toEqual([]);
  });
});

function shortTenuresOf(cv: string) {
  return countShortTenures(buildExperienceIndex(cv, REF));
}

describe("countShortTenures", () => {
  it("cuenta los empleos cuya duración máxima es de 12 meses o menos", () => {
    const cv = [
      "Experiencia laboral",
      "Cajero - Alfa",
      "enero 2019 - junio 2019",
      "Asistente - Beta",
      "marzo 2020 - octubre 2020",
      "Auxiliar - Gamma",
      "febrero 2021 - septiembre 2021",
    ].join("\n");
    expect(shortTenuresOf(cv)).toBe(3);
  });

  it("no cuenta como corto un empleo declarado solo con el año (podría abarcar hasta 24 meses)", () => {
    const cv = [
      "Experiencia laboral",
      "Cajero - Alfa",
      "2015 - 2016",
      "Asistente - Beta",
      "2017 - 2018",
      "Auxiliar - Gamma",
      "2019 - 2020",
    ].join("\n");
    expect(shortTenuresOf(cv)).toBe(0);
  });

  it("no cuenta un empleo largo", () => {
    const cv = ["Experiencia laboral", "Analista - Alfa", "enero 2015 - diciembre 2021"].join("\n");
    expect(shortTenuresOf(cv)).toBe(0);
  });
});

describe("describeJobHopping", () => {
  it("emite una nota neutra con la cifra cuando hay 3 o más empleos cortos", () => {
    const notes = describeJobHopping(3);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("3");
    expect(notes[0]!.toLowerCase()).toContain("entrevista");
    expect(notes[0]!.toLowerCase()).toContain("no es un motivo de descarte");
  });

  it("no emite nota con menos de 3 empleos cortos", () => {
    expect(describeJobHopping(2)).toEqual([]);
    expect(describeJobHopping(0)).toEqual([]);
  });
});
