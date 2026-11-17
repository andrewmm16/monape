import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { parseDocxStyles, stripHiddenDocxText, stripHiddenRuns } from "@/modules/resumes/docx-hidden";
import { extractResumeParts } from "@/modules/resumes/extraction-core";
import { summarizeHidden } from "@/modules/resumes/hidden-text";
import { makeDocx } from "../fixtures/documents";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string, beforeBody = "") => `<?xml version="1.0"?><w:document ${W}>${beforeBody}<w:body>${body}</w:body></w:document>`;
const run = (text: string, rPr = "") => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
const styles = (inner: string) => parseDocxStyles(`<w:styles ${W}>${inner}</w:styles>`);
const NO_STYLES = parseDocxStyles(null);
const strip = (xml: string, s = NO_STYLES) => stripHiddenRuns(xml, s);

describe("texto oculto en DOCX", () => {
  it("un documento sin nada oculto no cambia", () => {
    const xml = doc(p(run("Analista contable")) + p(run("Excel avanzado", '<w:b/><w:sz w:val="22"/>')));
    expect(strip(xml)).toEqual({ xml, hidden: [] });
  });

  it("el texto marcado como oculto en Word (w:vanish) se excluye y se informa", () => {
    const { xml, hidden } = strip(doc(p(run("Visible. "), run("Python AWS", "<w:vanish/>"))));
    expect(xml).toContain("Visible. ");
    expect(xml).not.toContain("Python AWS");
    expect(hidden).toEqual([{ fragment: { str: "Python AWS" }, reason: "vanish" }]);
  });

  it("w:vanish desactivado (val=0) es texto visible", () => {
    expect(strip(doc(p(run("Visible", '<w:vanish w:val="0"/>')))).hidden).toEqual([]);
  });

  it("fuente de menos de 3 pt se excluye; de 3 pt en adelante, no", () => {
    const { hidden } = strip(doc(p(run("Kubernetes", '<w:sz w:val="4"/>')) + p(run("Nota al pie", '<w:sz w:val="6"/>'))));
    expect(hidden).toEqual([{ fragment: { str: "Kubernetes", fontSize: 2 }, reason: "tiny" }]);
  });

  it("blanco (o casi blanco) sobre fondo blanco se excluye", () => {
    const { hidden } = strip(doc(p(run("Scrum", '<w:color w:val="FFFFFF"/>')) + p(run("SQL", '<w:color w:val="F7F7F7"/>'))));
    expect(hidden.map((h) => [h.fragment.str, h.reason])).toEqual([
      ["Scrum", "white"],
      ["SQL", "white"],
    ]);
  });

  it("un gris claro pero legible no se marca", () => {
    expect(strip(doc(p(run("Gris", '<w:color w:val="BFBFBF"/>')))).hidden).toEqual([]);
  });

  it("blanco sobre un fondo de color (ejecución, resaltado, párrafo o celda) es visible", () => {
    const blanco = '<w:color w:val="FFFFFF"/>';
    const casos = [
      p(run("Run sombreado", `${blanco}<w:shd w:val="clear" w:color="auto" w:fill="1F3864"/>`)),
      p(run("Resaltado", `${blanco}<w:highlight w:val="darkBlue"/>`)),
      `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="2E2E2E"/></w:pPr>${run("Párrafo sombreado", blanco)}</w:p>`,
      `<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="003366"/></w:tcPr>${p(run("Barra lateral", blanco))}</w:tc></w:tr></w:tbl>`,
    ];
    for (const caso of casos) expect(strip(doc(caso)).hidden).toEqual([]);
  });

  it("con color de página o formas que pueden quedar detrás del texto, no se marca el blanco", () => {
    const blanco = p(run("Texto blanco", '<w:color w:val="FFFFFF"/>'));
    expect(strip(doc(blanco, '<w:background w:color="1F3864"/>')).hidden).toEqual([]);
    expect(strip(doc(`<w:p><w:r><w:pict><v:rect fillcolor="#1F3864"/></w:pict></w:r></w:p>${blanco}`)).hidden).toEqual([]);
    expect(strip(doc(blanco), NO_STYLES).hidden).toHaveLength(1);
  });

  it("dentro de un cuadro de texto no se evalúa el blanco, pero sí lo oculto", () => {
    const caja = (inner: string) => `<w:p><w:r><w:txbxContent>${inner}</w:txbxContent></w:r></w:p>`;
    expect(stripHiddenRuns(doc(caja(p(run("Blanco en caja", '<w:color w:val="FFFFFF"/>')))), NO_STYLES).hidden).toEqual([]);
    expect(stripHiddenRuns(doc(caja(p(run("Oculto en caja", "<w:vanish/>")))), NO_STYLES).hidden).toHaveLength(1);
  });

  it("un estilo de carácter oculto también cuenta, y la propiedad directa manda sobre el estilo", () => {
    const s = styles('<w:style w:type="character" w:styleId="Truco"><w:rPr><w:vanish/></w:rPr></w:style>');
    expect(strip(doc(p(run("Por estilo", '<w:rStyle w:val="Truco"/>'))), s).hidden).toEqual([
      { fragment: { str: "Por estilo" }, reason: "vanish" },
    ]);
    expect(strip(doc(p(run("Anulado", '<w:rStyle w:val="Truco"/><w:vanish w:val="0"/>'))), s).hidden).toEqual([]);
  });

  it("el formato del estilo de párrafo se hereda, también por «basedOn»", () => {
    const s = styles(
      '<w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:sz w:val="2"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Derivado"><w:basedOn w:val="Base"/></w:style>',
    );
    const { hidden } = strip(doc(`<w:p><w:pPr><w:pStyle w:val="Derivado"/></w:pPr>${run("Diminuto heredado")}</w:p>`), s);
    expect(hidden).toEqual([{ fragment: { str: "Diminuto heredado", fontSize: 1 }, reason: "tiny" }]);
  });

  it("la tabla con un estilo que sombrea celdas no marca el blanco", () => {
    const s = styles(
      '<w:style w:type="table" w:styleId="Oscura"><w:tblStylePr w:type="firstRow"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1F3864"/></w:tcPr></w:tblStylePr></w:style>',
    );
    const tabla = `<w:tbl><w:tblPr><w:tblStyle w:val="Oscura"/></w:tblPr><w:tr><w:tc>${p(run("Cabecera", '<w:color w:val="FFFFFF"/>'))}</w:tc></w:tr></w:tbl>`;
    expect(strip(doc(tabla), s).hidden).toEqual([]);
  });

  it("la marca de párrafo oculta (w:pPr/w:rPr) no oculta el texto del párrafo", () => {
    expect(strip(doc(`<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr>${run("Visible")}</w:p>`)).hidden).toEqual([]);
  });

  it("agrupa el texto oculto contiguo de un párrafo y decodifica las entidades XML", () => {
    const { hidden } = strip(doc(p(run("R&amp;D ", "<w:vanish/>"), run("Python", "<w:vanish/>"), run(" visible"), run("AWS", "<w:vanish/>"))));
    expect(hidden.map((h) => h.fragment.str)).toEqual(["R&D Python", "AWS"]);
  });
});

describe("extracción de un DOCX con texto oculto", () => {
  it("excluye el texto oculto del texto evaluado y lo devuelve aparte", async () => {
    const bytes = makeDocx([], { bodyXml: p(run("Analista de datos")) + p(run("Python AWS Kubernetes", "<w:vanish/>")) });
    const { text, hidden } = await extractResumeParts(bytes, "docx");
    expect(text).toContain("Analista de datos");
    expect(text).not.toContain("Kubernetes");
    expect(hidden).toEqual([{ fragment: { str: "Python AWS Kubernetes" }, reason: "vanish" }]);
    expect(summarizeHidden(hidden)).toContain("marcado como oculto en Word");
  });

  it("también limpia los encabezados y pies de página", async () => {
    const header = `<?xml version="1.0"?><w:hdr ${W}>${p(run("Encabezado visible"))}${p(run("SAP ERP", '<w:color w:val="FFFFFF"/>'))}</w:hdr>`;
    const bytes = makeDocx(["Cuerpo"], { extraEntries: { "word/header1.xml": strToU8(header) } });
    const { text, hidden } = await extractResumeParts(bytes, "docx");
    expect(text).toContain("Encabezado visible");
    expect(text).not.toContain("SAP ERP");
    expect(hidden.map((h) => h.reason)).toEqual(["white"]);
  });

  it("una forma en el encabezado desactiva el blanco en todo el documento", () => {
    const header = `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:pict><v:rect fillcolor="#003366"/></w:pict></w:r></w:p></w:hdr>`;
    const parts = {
      "word/document.xml": strToU8(doc(p(run("Nombre en blanco", '<w:color w:val="FFFFFF"/>')))),
      "word/header1.xml": strToU8(header),
    };
    expect(stripHiddenDocxText(parts).hidden).toEqual([]);
  });

  it("un DOCX normal no reporta nada oculto ni cambia su texto", async () => {
    const bytes = makeDocx(["Contador público colegiado", "Excel avanzado"]);
    const { text, hidden } = await extractResumeParts(bytes, "docx");
    expect(hidden).toEqual([]);
    expect(text).toContain("Contador público colegiado");
  });
});
