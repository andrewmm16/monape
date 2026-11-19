import { describe, expect, it } from "vitest";
import {
  describeVacancyCopy,
  findCopiedVacancyPhrases,
  isVacancyCopy,
  VACANCY_COPY_NOTE_PREFIX,
  vacancyAdText,
  vacancyCopyHint,
} from "@/modules/evaluation/vacancy-copy";

// Aviso ficticio de una vacante de RRHH (descripción + funciones).
const AVISO = vacancyAdText({
  description:
    "Buscamos un Asistente de Recursos Humanos para apoyar los procesos de personal de una empresa del sector retail con presencia en Lima.",
  responsibilities: [
    "Elaborar y controlar la planilla de remuneraciones, CTS y gratificaciones conforme a la normativa laboral vigente.",
    "Gestionar el proceso de reclutamiento y selección de personal operativo, desde la publicación del aviso hasta la incorporación.",
    "Mantener actualizados los legajos del personal y los registros en el T-Registro y el PLAME.",
  ].join("\n"),
});

const COPIA = [
  "Ana Ficticia Ríos",
  "Experiencia laboral",
  "Asistente de RRHH — Comercial Uno S.A.C. — 03/2021 - actualidad",
  "- Elaborar y controlar la planilla de remuneraciones, CTS y gratificaciones conforme a la normativa laboral vigente.",
  "- Atención de consultas del personal.",
  "- Mantener actualizados los legajos del personal y los registros en el T-Registro y el PLAME.",
].join("\n");

const ADAPTADO = [
  "Ana Ficticia Ríos",
  "Experiencia laboral",
  "Asistente de RRHH — Comercial Uno S.A.C. — 03/2021 - actualidad",
  "- Calculé la planilla mensual de 120 trabajadores, además de CTS y gratificaciones.",
  "- Reclutamiento y selección de personal operativo para 4 tiendas.",
  "- Registros en el T-Registro y el PLAME.",
].join("\n");

describe("CV que copia el aviso de la vacante", () => {
  it("detecta dos funciones copiadas tal cual y avisa", () => {
    const phrases = findCopiedVacancyPhrases(COPIA, AVISO);
    expect(phrases).toHaveLength(2);
    expect(isVacancyCopy(phrases)).toBe(true);
    const [note] = describeVacancyCopy(phrases);
    expect(note).toMatch(new RegExp(`^${VACANCY_COPY_NOTE_PREFIX} \\(2 tramos, \\d+ palabras\\)`));
    expect(note).toContain("No es un motivo de descarte");
  });

  it("las citas son el texto literal del CV, con su posición", () => {
    for (const phrase of findCopiedVacancyPhrases(COPIA, AVISO)) {
      expect(COPIA.slice(phrase.start, phrase.end)).toBe(phrase.quote);
    }
    expect(findCopiedVacancyPhrases(COPIA, AVISO)[0]!.quote).toBe(
      "Elaborar y controlar la planilla de remuneraciones, CTS y gratificaciones conforme a la normativa laboral vigente",
    );
  });

  it("no marca un CV adaptado con las mismas palabras clave pero redacción propia", () => {
    expect(findCopiedVacancyPhrases(ADAPTADO, AVISO)).toEqual([]);
    expect(describeVacancyCopy(findCopiedVacancyPhrases(ADAPTADO, AVISO))).toEqual([]);
  });

  it("ignora mayúsculas, tildes y signos: copiar y cambiar la puntuación sigue siendo copiar", () => {
    const cv = "Experiencia\nELABORAR Y CONTROLAR LA PLANILLA DE REMUNERACIONES CTS Y GRATIFICACIONES CONFORME A LA NORMATIVA LABORAL VIGENTE";
    expect(findCopiedVacancyPhrases(cv, AVISO)).toHaveLength(1);
  });

  it("dos funciones copiadas una tras otra forman un solo tramo largo", () => {
    const cv = [
      "Experiencia",
      "Elaborar y controlar la planilla de remuneraciones, CTS y gratificaciones conforme a la normativa laboral vigente.",
      "Gestionar el proceso de reclutamiento y selección de personal operativo, desde la publicación del aviso hasta la incorporación.",
    ].join("\n");
    const phrases = findCopiedVacancyPhrases(cv, AVISO);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]!.words).toBe(34);
    expect(isVacancyCopy(phrases)).toBe(true);
  });

  it("un solo tramo de longitud media se encuentra, pero no basta para avisar", () => {
    // 13 palabras seguidas del aviso: puede ser una coincidencia de redacción.
    const cv = "Experiencia\nApoyé en gestionar el proceso de reclutamiento y selección de personal operativo, desde la publicación en portales.";
    const phrases = findCopiedVacancyPhrases(cv, AVISO);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]!.words).toBe(13);
    expect(isVacancyCopy(phrases)).toBe(false);
    expect(describeVacancyCopy(phrases)).toEqual([]);
    expect(vacancyCopyHint(phrases)).toBeNull();
  });

  it("una función entera del aviso (15 palabras o más) basta para avisar", () => {
    const cv =
      "Perfil\nGestionar el proceso de reclutamiento y selección de personal operativo, desde la publicación del aviso hasta la incorporación.";
    const phrases = findCopiedVacancyPhrases(cv, AVISO);
    expect(phrases).toHaveLength(1);
    expect(phrases[0]!.words).toBe(18);
    expect(isVacancyCopy(phrases)).toBe(true);
  });

  it("frases comunes del rubro (menos de 10 palabras seguidas) no cuentan", () => {
    const cv = "Experiencia\nPlanilla de remuneraciones, CTS y gratificaciones. Reclutamiento y selección de personal. Legajos del personal.";
    expect(findCopiedVacancyPhrases(cv, AVISO)).toEqual([]);
  });

  it("un tramo sin palabras con contenido no cuenta", () => {
    const aviso = "de la a la de lo y la de el a un de la o";
    expect(findCopiedVacancyPhrases(`Experiencia\n${aviso}`, aviso)).toEqual([]);
  });

  it("sin aviso (o con uno muy corto) no hay nada que comparar", () => {
    expect(findCopiedVacancyPhrases(COPIA, "")).toEqual([]);
    expect(findCopiedVacancyPhrases(COPIA, "Asistente de RRHH")).toEqual([]);
  });

  it("la pista para la IA pide no acreditar lo que solo está copiado", () => {
    const hint = vacancyCopyHint(findCopiedVacancyPhrases(COPIA, AVISO));
    expect(hint).toMatch(new RegExp(`^${VACANCY_COPY_NOTE_PREFIX}`));
    expect(hint).toContain("pendiente_verificacion");
  });

  it("el texto del aviso une descripción y funciones, sin partes vacías", () => {
    expect(vacancyAdText({ description: "Uno", responsibilities: "  " })).toBe("Uno");
    expect(vacancyAdText({ description: null, responsibilities: "Dos" })).toBe("Dos");
    expect(vacancyAdText({ description: "Uno", responsibilities: "Dos" })).toBe("Uno\nDos");
  });
});
