import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OcrEngine, OcrRun } from "@/modules/resumes/ocr";
import { makePdf } from "../fixtures/documents";

const mocks = vi.hoisted(() => ({ run: null as unknown }));
vi.mock("@/modules/resumes/ocr", () => ({ runOcr: async () => mocks.run }));

const { extractResume } = await import("@/modules/resumes/extraction");

const engine: OcrEngine = {
  id: "falso",
  extractorVersion: "ocr-falso",
  available: () => true,
  recognize: async () => ({ ok: false, reason: "ocr_fallido" }),
};
const DIGITAL = "Persona Ficticia Rojas\nExperiencia con SQL Server y reportes.";
const setRun = (run: OcrRun) => (mocks.run = run);

describe("PDF con texto digital parcial y OCR en línea", () => {
  let pdf: Uint8Array;
  beforeEach(async () => {
    pdf ??= await makePdf(["Persona Ficticia Rojas", "Experiencia con SQL Server y reportes."]);
  });

  it("el texto digital mide menos de 80 caracteres pero alcanza para evaluar (≥ 50)", () => {
    expect(DIGITAL.length).toBeGreaterThanOrEqual(50);
    expect(DIGITAL.length).toBeLessThan(80);
  });

  it("OCR sin texto útil: conserva el digital, marca el intento y mezcla los avisos", async () => {
    setRun({ status: "ok", engine, text: " ", pagesRead: 1, totalPages: 1 });
    const result = await extractResume(pdf, "pdf", { ocr: "inline" });
    expect(result).toMatchObject({ status: "sin_texto", method: "pdf_ocr", extractorVersion: "ocr-falso", errorCode: null });
    expect(result.text).toBe(DIGITAL);
    expect(result.warnings.join(" ")).toContain("no encontró texto útil");
  });

  it("OCR fallido: conserva el digital con el código del fallo", async () => {
    setRun({ status: "fallido", engine, reason: "tiempo_agotado" });
    const result = await extractResume(pdf, "pdf", { ocr: "inline" });
    expect(result).toMatchObject({ status: "sin_texto", method: "pdf_ocr", errorCode: "tiempo_agotado" });
    expect(result.text).toBe(DIGITAL);
  });

  it("OCR sin resultado útil pero más largo que el digital: queda el más largo", async () => {
    const longer = "Persona Ficticia Rojas Quispe\nExperiencia con SQL Server, Power BI y reportes.";
    expect(longer.length).toBeLessThan(80);
    setRun({ status: "ok", engine, text: longer, pagesRead: 1, totalPages: 1 });
    const result = await extractResume(pdf, "pdf", { ocr: "inline" });
    expect(result).toMatchObject({ status: "sin_texto", method: "pdf_ocr" });
    expect(result.text).toBe(longer);
  });

  it("OCR completado: se usa el del OCR", async () => {
    const full = `${DIGITAL}\nAnalista de datos con experiencia en reportes de gestión para las áreas usuarias.`;
    setRun({ status: "ok", engine, text: full, pagesRead: 1, totalPages: 1 });
    const result = await extractResume(pdf, "pdf", { ocr: "inline" });
    expect(result).toMatchObject({ status: "completada", method: "pdf_ocr" });
    expect(result.text).toBe(full);
  });

  it("si el OCR no pudo intentarse, queda el resultado digital de siempre", async () => {
    setRun({ status: "ocupado" });
    const result = await extractResume(pdf, "pdf", { ocr: "inline" });
    expect(result).toMatchObject({ status: "sin_texto", method: "pdf_text" });
    expect(result.text).toBe(DIGITAL);
  });
});
