import { strFromU8, unzipSync, zipSync } from "fflate";

/**
 * Inspección defensiva de archivos DOCX (ZIP con XML):
 *  - presupuestos de entradas y de tamaño descomprimido verificados ANTES de
 *    descomprimir cada entrada (protección ante "zip bombs"; fflate nunca
 *    descomprime más allá del tamaño declarado en el directorio);
 *  - rechazo de macros, objetos incrustados y plantillas remotas;
 *  - solo se descomprimen las partes XML necesarias para leer el texto.
 */
const MAX_ENTRIES = 1000;
const MAX_TOTAL_UNCOMPRESSED = 60 * 1024 * 1024;
const MAX_TEXT_PARTS_SIZE = 30 * 1024 * 1024;
const MAX_PART_SIZE = 20 * 1024 * 1024;
const MAX_RATIO = 250;

class ZipBudgetExceeded extends Error {}

const MACRO_CONTENT_TYPE = /macroEnabled|vbaProject|activeX/i;
const EXTERNAL_RISKY_RELATIONSHIP =
  /<Relationship\b(?=[^>]*TargetMode="External")(?=[^>]*Type="[^"]*\/(?:attachedTemplate|oleObject|frame|subDocument|package)")[^>]*>/i;

export type DocxInspection =
  | { ok: true; parts: Record<string, Uint8Array> }
  | { ok: false; reason: string };

function isTextPart(name: string): boolean {
  return (
    name === "[Content_Types].xml" ||
    name === "_rels/.rels" ||
    (name.startsWith("word/") && (name.endsWith(".xml") || name.endsWith(".rels")) && !name.startsWith("word/media/"))
  );
}

export function inspectDocx(bytes: Uint8Array): DocxInspection {
  const names: string[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let textTotal = 0;
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(bytes, {
      // Se invoca antes de descomprimir cada entrada: cualquier exceso aborta
      // la lectura sin reservar memoria para el resto del archivo.
      filter(file) {
        if (seen.has(file.name)) throw new ZipBudgetExceeded("entrada duplicada");
        seen.add(file.name);
        names.push(file.name);
        declaredTotal += file.originalSize;
        if (names.length > MAX_ENTRIES || declaredTotal > MAX_TOTAL_UNCOMPRESSED) throw new ZipBudgetExceeded("tamaño");
        if (file.originalSize > 1024 * 1024 && file.originalSize / Math.max(file.size, 1) > MAX_RATIO) {
          throw new ZipBudgetExceeded("compresión anómala");
        }
        if (!isTextPart(file.name) || file.originalSize > MAX_PART_SIZE) return false;
        textTotal += file.originalSize;
        if (textTotal > MAX_TEXT_PARTS_SIZE) throw new ZipBudgetExceeded("texto");
        return true;
      },
    });
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof ZipBudgetExceeded
          ? "El documento DOCX tiene una estructura o un tamaño descomprimido anómalo y no se acepta por seguridad."
          : "El archivo DOCX está dañado o no es un documento válido.",
    };
  }

  if (names.length === 0) {
    return { ok: false, reason: "La estructura del documento DOCX no es válida." };
  }

  if (!names.includes("[Content_Types].xml") || !parts["word/document.xml"]) {
    return { ok: false, reason: "El archivo no es un documento de Word (DOCX) válido." };
  }
  if (names.some((name) => /vbaProject\.bin$/i.test(name) || /^word\/(?:embeddings|activeX)\//i.test(name))) {
    return { ok: false, reason: "El documento contiene macros u objetos incrustados y no se acepta por seguridad." };
  }

  const contentTypes = strFromU8(parts["[Content_Types].xml"] ?? new Uint8Array());
  if (MACRO_CONTENT_TYPE.test(contentTypes)) {
    return { ok: false, reason: "El documento contiene macros y no se acepta por seguridad." };
  }

  for (const [name, data] of Object.entries(parts)) {
    if (name.endsWith(".rels") && EXTERNAL_RISKY_RELATIONSHIP.test(strFromU8(data))) {
      return { ok: false, reason: "El documento hace referencia a plantillas u objetos externos y no se acepta por seguridad." };
    }
  }

  return { ok: true, parts };
}

/** Reempaqueta solo las partes de texto validadas para el extractor. */
export function repackTextParts(parts: Record<string, Uint8Array>): Uint8Array {
  return zipSync(parts, { level: 1 });
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity.toLowerCase()] ?? "";
  });
}

/** Texto de encabezados y pies de página (el extractor principal los omite). */
export function extractHeaderFooterText(parts: Record<string, Uint8Array>): string {
  const texts: string[] = [];
  for (const [name, data] of Object.entries(parts)) {
    if (!/^word\/(?:header|footer)\d*\.xml$/.test(name)) continue;
    const xml = strFromU8(data);
    const paragraphs = xml
      .split(/<\/w:p>/)
      .map((paragraph) =>
        [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decodeXmlText(m[1]!)).join(""),
      )
      .map((line) => line.trim())
      .filter(Boolean);
    texts.push(...paragraphs);
  }
  return [...new Set(texts)].join("\n");
}
