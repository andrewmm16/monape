/**
 * Genera los MISMOS CV ficticios en formato .docx, para medir el motor por la
 * otra ruta de extracción que acepta la aplicación (`ResumeFileKind`).
 *
 * Uso (desde la raíz): npx tsx scripts/generar-cv-docx.ts
 *
 * Por qué hace falta. Los cuatro bancos anteriores entran todos por PDF, y un
 * .docx no se parece en nada por dentro: no hay cortes de línea por el ancho de
 * la hoja (un párrafo es un solo texto, se parta donde se parta al imprimirlo),
 * no hay letras espaciadas por el renderizador, y en cambio aparecen dos cosas
 * que el PDF no tiene: el texto de la cabecera y el pie, que viven en partes
 * separadas del archivo, y las tablas. En Perú una parte de los CV llega en
 * Word, así que esa ruta tiene que estar medida.
 *
 * El .docx se construye a mano con fflate (un .docx es un zip con XML). Son
 * cuatro partes: tipos de contenido, la relación raíz, el documento y sus
 * relaciones. Dos CV llevan además los datos de contacto en la CABECERA, que
 * es donde los pone Word en muchas plantillas y donde la extracción tiene que
 * ir a buscarlos.
 */
import { zipSync, strToU8 } from "fflate";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import { identidad, PUESTOS, type Cv } from "./generar-cv-prueba";

/** Los CV cuyos datos de contacto van en la cabecera del documento, no en el cuerpo. */
const CON_CABECERA = new Set(["CV_Quispe_Carmen", "CV_Vilca_Katherine"]);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Un párrafo; `estilo` marca los títulos de sección como encabezado de Word. */
function parrafo(texto: string, estilo?: "Heading1" | "Heading2"): string {
  const propiedades = estilo === undefined ? "" : `<w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>`;
  // `xml:space="preserve"` para que Word no coma los espacios de los extremos.
  return `<w:p>${propiedades}<w:r><w:t xml:space="preserve">${esc(texto)}</w:t></w:r></w:p>`;
}

/** Tabla de dos columnas: así es como muchas plantillas de Word ponen las habilidades. */
function tabla(filas: Array<[string, string]>): string {
  const celda = (texto: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${parrafo(texto)}</w:tc>`;
  const cuerpo = filas.map(([a, b]) => `<w:tr>${celda(a)}${celda(b)}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>${cuerpo}</w:tbl>`;
}

function cuerpoDelCv(cv: Cv, correo: string, telefono: string, enCabecera: boolean): string {
  const partes: string[] = [parrafo(`${cv.nombre} ${cv.apellido}`, "Heading1"), parrafo(cv.titular)];
  if (!enCabecera) partes.push(parrafo(`${correo} | Tel. ${telefono} | ${cv.ciudad}`));

  partes.push(parrafo("Resumen profesional", "Heading2"), parrafo(cv.resumen));

  partes.push(parrafo("Experiencia laboral", "Heading2"));
  for (const e of cv.exp) {
    partes.push(parrafo(`${e.cargo}\t${e.periodo}`));
    partes.push(parrafo(e.empresa));
    for (const logro of e.logros) partes.push(parrafo(`• ${logro}`));
  }

  partes.push(parrafo("Formación", "Heading2"));
  for (const f of cv.formacion) partes.push(parrafo(`• ${f}`));

  // Las habilidades en TABLA de dos columnas, que es el caso que el PDF no cubre.
  partes.push(parrafo("Habilidades", "Heading2"));
  const filas: Array<[string, string]> = [];
  for (let i = 0; i < cv.habilidades.length; i += 2) {
    filas.push([cv.habilidades[i]!, cv.habilidades[i + 1] ?? ""]);
  }
  partes.push(tabla(filas));

  partes.push(parrafo("Idiomas", "Heading2"));
  for (const idioma of cv.idiomas) partes.push(parrafo(`• ${idioma}`));

  partes.push(parrafo("CV ficticio generado para pruebas. Nombres, empresas y datos inventados."));
  return partes.join("");
}

const TIPOS_CONTENIDO = (conCabecera: boolean) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
${conCabecera ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}
</Types>`;

const RELS_RAIZ = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const RELS_DOCUMENTO = (conCabecera: boolean) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${conCabecera ? '<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ""}
</Relationships>`;

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function documentoXml(contenido: string, conCabecera: boolean): string {
  const seccion = conCabecera
    ? '<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/></w:sectPr>'
    : "<w:sectPr/>";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${contenido}${seccion}</w:body></w:document>`;
}

function cabeceraXml(texto: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W_NS}>${parrafo(texto)}</w:hdr>`;
}

function construirDocx(cv: Cv, correo: string, telefono: string, enCabecera: boolean): Uint8Array {
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(TIPOS_CONTENIDO(enCabecera)),
    "_rels/.rels": strToU8(RELS_RAIZ),
    "word/document.xml": strToU8(documentoXml(cuerpoDelCv(cv, correo, telefono, enCabecera), enCabecera)),
    "word/_rels/document.xml.rels": strToU8(RELS_DOCUMENTO(enCabecera)),
  };
  if (enCabecera) {
    archivos["word/header1.xml"] = strToU8(cabeceraXml(`${correo} | Tel. ${telefono} | ${cv.ciudad}`));
  }
  return zipSync(archivos, { level: 6 });
}

async function main(): Promise<void> {
  const raiz = path.resolve(import.meta.dirname, "..", "cv-prueba-docx");
  let n = 0;
  for (const puesto of PUESTOS) {
    const dir = path.join(raiz, puesto.carpeta);
    mkdirSync(dir, { recursive: true });
    for (const cv of puesto.cvs) {
      n++;
      const { base, correo, telefono } = identidad(cv, n);
      const enCabecera = CON_CABECERA.has(base);
      const bytes = construirDocx(cv, correo, telefono, enCabecera);
      await writeFile(path.join(dir, `${base}.docx`), bytes);
      stdout.write(`  OK ${path.join(puesto.carpeta, base)}.docx${enCabecera ? "  (contacto en la cabecera)" : ""}\n`);
    }
  }
  stdout.write(`\nGenerados ${n} CV .docx en ${raiz}\n`);
  stdout.write(`Mídalos con: npm run medir:motor:docx\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
