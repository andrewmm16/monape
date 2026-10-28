import { describe, expect, it } from "vitest";
import { extractResume, needsOcr, OCR_NOTICE, outcomeFromOcr } from "@/modules/resumes/extraction";
import { runOcrWithEngines, type OcrEngine, type OcrEngineResult } from "@/modules/resumes/ocr";
import { MAX_OCR_PAGES, OCR_MAX_SIDE_PX, computeRenderScale } from "@/modules/resumes/ocr-render-core";
import { makeScannedPdf } from "../fixtures/documents";

const PDF = new Uint8Array([1, 2, 3]);

function fakeEngine(id: string, result: OcrEngineResult | "throws", options: { available?: boolean } = {}) {
  const calls: Uint8Array[] = [];
  const engine: OcrEngine = {
    id,
    extractorVersion: `fake-${id}`,
    available: () => options.available ?? true,
    async recognize(bytes) {
      calls.push(bytes);
      if (result === "throws") throw new Error("falla inesperada");
      return result;
    },
  };
  return { engine, calls };
}

const LONG_TEXT =
  "María Quispe Ramos. Analista de datos con experiencia en SQL Server y reportes de gestión para áreas usuarias.";

describe("motores de OCR con prioridad", () => {
  it("usa el primero disponible y no consulta a los demás si lee", async () => {
    const first = fakeEngine("a", { ok: true, text: "uno", pagesRead: 1, totalPages: 1 });
    const second = fakeEngine("b", { ok: true, text: "dos", pagesRead: 1, totalPages: 1 });
    const run = await runOcrWithEngines([first.engine, second.engine], PDF);
    expect(run).toMatchObject({ status: "ok", text: "uno" });
    expect(second.calls).toHaveLength(0);
  });

  it("salta los no disponibles y pasa al siguiente si uno falla o lanza", async () => {
    const unavailable = fakeEngine("a", { ok: true, text: "x", pagesRead: 1, totalPages: 1 }, { available: false });
    const failing = fakeEngine("b", { ok: false, reason: "ocr_fallido" });
    const throwing = fakeEngine("c", "throws");
    const good = fakeEngine("d", { ok: true, text: "cuatro", pagesRead: 2, totalPages: 5 });
    const run = await runOcrWithEngines([unavailable.engine, failing.engine, throwing.engine, good.engine], PDF);
    expect(unavailable.calls).toHaveLength(0);
    expect(failing.calls).toHaveLength(1);
    expect(throwing.calls).toHaveLength(1);
    expect(run).toMatchObject({ status: "ok", text: "cuatro", pagesRead: 2, totalPages: 5 });
    expect(run.status === "ok" && run.engine.id).toBe("d");
  });

  it("pasa el plazo de cola al motor", async () => {
    const seen: unknown[] = [];
    const engine: OcrEngine = {
      id: "q",
      extractorVersion: "q",
      available: () => true,
      async recognize(_bytes, options) {
        seen.push(options);
        return { ok: true, text: "x", pagesRead: 1, totalPages: 1 };
      },
    };
    await runOcrWithEngines([engine], PDF, { queueTimeoutMs: 5_000 });
    expect(seen).toEqual([{ queueTimeoutMs: 5_000 }]);
  });

  it("informa el último fallo, la espera en cola y la falta de motores", async () => {
    const timeout = fakeEngine("a", { ok: false, reason: "tiempo_agotado" });
    expect(await runOcrWithEngines([timeout.engine], PDF)).toMatchObject({ status: "fallido", reason: "tiempo_agotado" });
    const busy = fakeEngine("b", { ok: false, reason: "ocupado" });
    expect(await runOcrWithEngines([busy.engine], PDF)).toEqual({ status: "ocupado" });
    expect(await runOcrWithEngines([], PDF)).toEqual({ status: "no_disponible" });
    const off = fakeEngine("c", { ok: true, text: "x", pagesRead: 1, totalPages: 1 }, { available: false });
    expect(await runOcrWithEngines([off.engine], PDF)).toEqual({ status: "no_disponible" });
  });
});

describe("resultado del OCR como extracción", () => {
  const engine = fakeEngine("local", { ok: false, reason: "ocr_fallido" }).engine;

  it("texto útil: pdf_ocr completada, con aviso y sugerencias", () => {
    const outcome = outcomeFromOcr({
      status: "ok",
      engine,
      text: `${LONG_TEXT}\nmaria.quispe@correo.test`,
      pagesRead: 1,
      totalPages: 1,
    });
    expect(outcome).toMatchObject({ status: "completada", method: "pdf_ocr", extractorVersion: "fake-local", errorCode: null });
    expect(outcome?.warnings).toEqual([OCR_NOTICE]);
    expect(outcome?.suggestions.email?.value).toBe("maria.quispe@correo.test");
  });

  it("avisa cuando solo se leyeron las primeras páginas", () => {
    const outcome = outcomeFromOcr({ status: "ok", engine, text: LONG_TEXT, pagesRead: 4, totalPages: 7 });
    expect(outcome?.warnings).toContain("Solo se leyeron las primeras 4 páginas de 7.");
  });

  it("sin texto útil: pdf_ocr sin_texto y sin código de error", () => {
    const outcome = outcomeFromOcr({ status: "ok", engine, text: " ~ ", pagesRead: 1, totalPages: 1 });
    expect(outcome).toMatchObject({ status: "sin_texto", method: "pdf_ocr", errorCode: null });
    expect(outcome?.suggestions.skills).toEqual([]);
  });

  it("fallo del motor: pdf_ocr sin_texto con su código", () => {
    expect(outcomeFromOcr({ status: "fallido", engine, reason: "ocr_fallido" })).toMatchObject({
      status: "sin_texto",
      method: "pdf_ocr",
      errorCode: "ocr_fallido",
    });
    expect(outcomeFromOcr({ status: "fallido", engine, reason: "tiempo_agotado" })?.errorCode).toBe("tiempo_agotado");
  });

  it("si el OCR no pudo intentarse, no hay resultado (el CV queda como estaba)", () => {
    expect(outcomeFromOcr({ status: "ocupado" })).toBeNull();
    expect(outcomeFromOcr({ status: "no_disponible" })).toBeNull();
  });

  it("solo es apto para OCR automático el PDF sin texto sin OCR previo", () => {
    expect(needsOcr({ status: "sin_texto", method: "pdf_text" })).toBe(true);
    expect(needsOcr({ status: "sin_texto", method: "pdf_ocr" })).toBe(false);
    expect(needsOcr({ status: "completada", method: "pdf_text" })).toBe(false);
    expect(needsOcr({ status: "sin_texto", method: "docx_text" })).toBe(false);
  });
});

describe("escala de renderizado", () => {
  it("A4 se renderiza a ≈300 dpi", () => {
    expect(computeRenderScale(595, 842)).toBeCloseTo(300 / 72, 5);
    expect(Math.round(842 * computeRenderScale(595, 842))).toBeLessThanOrEqual(OCR_MAX_SIDE_PX);
  });

  it("limita el lado mayor de páginas muy grandes", () => {
    const scale = computeRenderScale(2000, 3000);
    expect(3000 * scale).toBeCloseTo(OCR_MAX_SIDE_PX, 5);
    expect(computeRenderScale(5000, 100) * 5000).toBeCloseTo(OCR_MAX_SIDE_PX, 5);
  });

  it("tamaños no válidos usan la escala base", () => {
    expect(computeRenderScale(0, 0)).toBeCloseTo(300 / 72, 5);
    expect(computeRenderScale(Number.NaN, 10)).toBeCloseTo(300 / 72, 5);
  });
});

describe("OCR local real (tesseract.js + spa, sin red)", () => {
  const lines = [
    "María Fernanda Quispe Ramos",
    "Analista de datos",
    "maria.quispe@correo.test",
    "Teléfono: 987 654 321",
    "Experiencia con SQL Server, Power BI y reportes de gestión para las áreas usuarias.",
    "Formación en ingeniería industrial. Universidad ficticia, Lima.",
  ];

  it("lee un PDF escaneado generado y propone nombre, correo y herramientas", async () => {
    const scanned = await makeScannedPdf(lines);
    // Sin OCR en línea queda pendiente de OCR.
    const plain = await extractResume(scanned, "pdf");
    expect(plain).toMatchObject({ status: "sin_texto", method: "pdf_text" });

    const result = await extractResume(scanned, "pdf", { ocr: "inline" });
    expect(result).toMatchObject({ status: "completada", method: "pdf_ocr", extractorVersion: "ocr-local-tesseract7-spa" });
    expect(result.warnings).toContain(OCR_NOTICE);
    expect(result.text).toContain("Quispe");
    expect(result.text).toContain("Analista de datos");
    // El modelo español de tesseract lee mal la arroba (la confunde con «(O» o «Q»), así que el
    // correo no se sugiere: RRHH lo escribe al revisar. El teléfono sí se reconoce.
    expect(result.text).toContain("correo.test");
    expect(result.suggestions.phone?.value).toBe("987 654 321");
    expect(result.suggestions.skills.map((skill) => skill.value)).toEqual(expect.arrayContaining(["SQL Server"]));
  }, 90_000);

  it("lee como máximo 4 páginas y lo avisa", async () => {
    const scanned = await makeScannedPdf(lines, MAX_OCR_PAGES + 1);
    const result = await extractResume(scanned, "pdf", { ocr: "inline" });
    expect(result.method).toBe("pdf_ocr");
    expect(result.warnings).toContain(`Solo se leyeron las primeras ${MAX_OCR_PAGES} páginas de ${MAX_OCR_PAGES + 1}.`);
  }, 120_000);

  it("una página en blanco queda como OCR intentado sin texto útil", async () => {
    const blank = await makeScannedPdf([]);
    const result = await extractResume(blank, "pdf", { ocr: "inline" });
    expect(result).toMatchObject({ status: "sin_texto", method: "pdf_ocr", errorCode: null });
  }, 90_000);
});
