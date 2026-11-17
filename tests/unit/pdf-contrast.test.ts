import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
} from "pdf-lib";
import { extractResumeParts } from "@/modules/resumes/extraction-core";
import { findHiddenFragments, summarizeHidden } from "@/modules/resumes/hidden-text";
import { hasContrast, lowContrastFlags, plausibleHiddenShare, textBox, type Box, type Raster } from "@/modules/resumes/pdf-contrast";
import { makePdf } from "../fixtures/documents";

/** Imagen RGBA de prueba: fondo liso y, opcionalmente, un rectángulo de otro color. */
function raster(width: number, height: number, bg: number[], rect?: { box: Box; color: number[] }): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inRect = rect && x >= rect.box.x0 && x < rect.box.x1 && y >= rect.box.y0 && y < rect.box.y1;
      const [r, g, b, a = 255] = inRect ? rect.color : bg;
      data.set([r!, g!, b!, a], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const BOX: Box = { x0: 10, y0: 10, x1: 40, y1: 20 };
const WHITE = [255, 255, 255];

describe("caja del texto en píxeles", () => {
  // Viewport real de pdf.js: escala 1 y eje y invertido en una página de 200 pt de alto.
  const viewport = [1, 0, 0, -1, 0, 200];
  const size = { width: 300, height: 300 };

  it("ubica un texto horizontal desde un poco bajo la línea base hasta el cuerpo de la letra", () => {
    expect(textBox({ transform: [10, 0, 0, 10, 50, 100], width: 40, height: 10 }, viewport, size)).toEqual({
      x0: 50,
      y0: 92,
      x1: 90,
      y1: 102,
    });
  });

  it("el texto rotado, sin ancho o fuera de la imagen no tiene caja (se da por visible)", () => {
    expect(textBox({ transform: [0, 10, -10, 0, 50, 100], width: 40, height: 10 }, viewport, size)).toBeNull();
    expect(textBox({ transform: [10, 0, 0, 10, 50, 100], width: 0, height: 10 }, viewport, size)).toBeNull();
    expect(textBox({ transform: [10, 0, 0, 10, 900, 100], width: 40, height: 10 }, viewport, size)).toBeNull();
  });
});

describe("contraste dentro de la caja", () => {
  it("un área lisa (blanco sobre blanco) no tiene contraste", () => {
    expect(hasContrast(raster(50, 30, WHITE), BOX)).toBe(false);
  });

  it("trazos oscuros sobre blanco sí lo tienen", () => {
    expect(hasContrast(raster(50, 30, WHITE, { box: { x0: 15, y0: 12, x1: 17, y1: 18 }, color: [0, 0, 0] }), BOX)).toBe(true);
  });

  it("casi blanco (#F8F8F8) sobre blanco no alcanza el umbral; un gris claro legible sí", () => {
    const trazo = (gris: number) => raster(50, 30, WHITE, { box: { x0: 15, y0: 12, x1: 17, y1: 18 }, color: [gris, gris, gris] });
    expect(hasContrast(trazo(248), BOX)).toBe(false);
    expect(hasContrast(trazo(191), BOX)).toBe(true);
  });

  it("blanco sobre una barra oscura se ve", () => {
    expect(hasContrast(raster(50, 30, [20, 30, 70], { box: { x0: 15, y0: 12, x1: 17, y1: 18 }, color: WHITE }), BOX)).toBe(true);
  });

  it("los píxeles transparentes cuentan como el blanco del papel", () => {
    expect(hasContrast(raster(50, 30, [0, 0, 0, 0]), BOX)).toBe(false);
  });

  it("los items en blanco se dan por visibles", () => {
    const item = { str: "   ", transform: [10, 0, 0, 10, 10, 10], width: 20, height: 10 };
    expect(lowContrastFlags([item], [1, 0, 0, -1, 0, 30], raster(50, 30, WHITE))).toEqual([false]);
  });
});

describe("salvaguarda de documento", () => {
  it("acepta que una parte del texto sea invisible, pero no casi todo", () => {
    const items = (oculto: number) => [
      { str: "x".repeat(100 - oculto) },
      { str: "y".repeat(oculto), lowContrast: true },
    ];
    expect(plausibleHiddenShare(items(10))).toBe(true);
    expect(plausibleHiddenShare(items(80))).toBe(false);
    expect(plausibleHiddenShare([])).toBe(true);
  });
});

describe("motivo «sin contraste» en el aviso", () => {
  it("findHiddenFragments lo informa y el aviso lo explica", () => {
    const hidden = findHiddenFragments([{ str: "Python AWS", fontSize: 11, x: 50, y: 700, lowContrast: true }], { width: 595, height: 842 });
    expect(hidden.map((h) => h.reason)).toEqual(["nocontrast"]);
    expect(summarizeHidden(hidden)).toContain("del mismo color que el fondo o tapado por otro elemento");
  });
});

describe("extracción de un PDF con texto sin contraste", () => {
  async function pdfConTrucos(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const text = (t: string, y: number, color = rgb(0, 0, 0)) => page.drawText(t, { x: 50, y, size: 11, font, color });
    text("Contador publico colegiado", 790);
    text("Excel avanzado", 770);
    text("TRUCO_BLANCO Python AWS", 740, rgb(1, 1, 1));
    text("TRUCO_CASI_BLANCO Kubernetes", 720, rgb(0.973, 0.973, 0.973));
    text("TRUCO_TAPADO SAP", 700);
    page.drawRectangle({ x: 45, y: 695, width: 250, height: 20, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 40, y: 640, width: 300, height: 40, color: rgb(0.1, 0.15, 0.3) });
    text("Barra lateral en blanco legible", 655, rgb(1, 1, 1));
    text("Nota en gris claro legible", 620, rgb(0.75, 0.75, 0.75));
    return doc.save();
  }

  it("excluye el texto que no se distingue del fondo y conserva el visible", async () => {
    const { text, hidden } = await extractResumeParts(await pdfConTrucos(), "pdf");
    expect(text).toContain("Contador publico colegiado");
    expect(text).toContain("Barra lateral en blanco legible");
    expect(text).toContain("Nota en gris claro legible");
    expect(text).not.toContain("TRUCO");
    expect(hidden.map((h) => [h.fragment.str, h.reason])).toEqual([
      ["TRUCO_BLANCO Python AWS", "nocontrast"],
      ["TRUCO_CASI_BLANCO Kubernetes", "nocontrast"],
      ["TRUCO_TAPADO SAP", "nocontrast"],
    ]);
  });

  it("la capa de texto invisible de un PDF escaneado con OCR (sobre la imagen) se conserva", async () => {
    const canvas = createCanvas(1000, 100);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1000, 100);
    ctx.fillStyle = "#000000";
    ctx.font = "56px sans-serif";
    ctx.fillText("Contador publico colegiado", 20, 70);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawImage(await doc.embedPng(canvas.toBuffer("image/png")), { x: 50, y: 700, width: 500, height: 50 });
    page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
    page.drawText("Contador publico colegiado", { x: 60, y: 718, size: 20, font });
    page.pushOperators(popGraphicsState());
    const { text, hidden } = await extractResumeParts(await doc.save(), "pdf");
    expect(hidden).toEqual([]);
    expect(text).toContain("Contador publico colegiado");
  });

  it("si casi todo el texto parece invisible, no marca nada (render dudoso)", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    page.drawText("Todo el CV en blanco", { x: 50, y: 790, size: 11, font, color: rgb(1, 1, 1) });
    const { text, hidden } = await extractResumeParts(await doc.save(), "pdf");
    expect(hidden).toEqual([]);
    expect(text).toContain("Todo el CV en blanco");
  });

  it("con lowContrast: false no renderiza ni marca nada (lecturas en lote que no evalúan)", async () => {
    const { text, hidden } = await extractResumeParts(await pdfConTrucos(), "pdf", { lowContrast: false });
    expect(hidden.map((h) => h.reason)).not.toContain("nocontrast");
    expect(text).toContain("TRUCO_BLANCO");
  });

  it("un PDF normal no reporta nada oculto", async () => {
    const { text, hidden } = await extractResumeParts(await makePdf(["Analista contable", "Excel avanzado"]), "pdf");
    expect(hidden).toEqual([]);
    expect(text).toBe("Analista contable\nExcel avanzado");
  });
});
