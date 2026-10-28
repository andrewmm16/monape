import { strToU8, zipSync } from "fflate";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";

/** Genera un PDF con texto real (datos ficticios). */
export async function makePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((line, index) => {
    page.drawText(line, { x: 50, y: 790 - index * 18, size: 11, font });
  });
  return doc.save();
}

/**
 * PDF "escaneado": cada página es solo una imagen (texto dibujado a ~300 dpi),
 * sin texto extraíble. `pages` repite las líneas dadas en cada página.
 */
export async function makeScannedPdf(lines: string[], pages = 1): Promise<Uint8Array> {
  const width = 2480;
  const height = 3508;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#000000";
  context.font = "64px sans-serif";
  lines.forEach((line, index) => context.fillText(line, 200, 300 + index * 120));
  const png = canvas.toBuffer("image/png");

  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return doc.save();
}

/** PDF sin texto (equivalente a un documento escaneado sin OCR). */
export async function makeEmptyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type DocxOptions = {
  header?: string;
  macro?: boolean;
  embedded?: boolean;
  externalTemplate?: boolean;
  extraEntries?: Record<string, Uint8Array>;
};

/** Genera un DOCX mínimo válido (y variantes maliciosas para pruebas). */
export function makeDocx(paragraphs: string[], options: DocxOptions = {}): Uint8Array {
  const contentType = options.macro
    ? "application/vnd.ms-word.document.macroEnabled.main+xml"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${contentType}"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
        options.header
          ? '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
          : ""
      }</Relationships>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
        .map((p) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`)
        .join("")}</w:body></w:document>`,
    ),
  };
  if (options.header) {
    files["word/header1.xml"] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${escapeXml(options.header)}</w:t></w:r></w:p></w:hdr>`,
    );
  }
  if (options.macro) files["word/vbaProject.bin"] = new Uint8Array([1, 2, 3]);
  if (options.embedded) files["word/embeddings/oleObject1.bin"] = new Uint8Array([1, 2, 3]);
  if (options.externalTemplate) {
    files["word/_rels/settings.xml.rels"] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://ejemplo.test/plantilla.dotm" TargetMode="External"/></Relationships>`,
    );
  }
  Object.assign(files, options.extraEntries ?? {});
  return zipSync(files);
}
