import { randomBytes } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { extractResume } from "@/modules/resumes/extraction";
import { sanitizeFileName, validateResumeFile } from "@/modules/resumes/file-validation";
import { suggestFields } from "@/modules/resumes/suggestions";
import { makeDocx, makeEmptyPdf, makePdf } from "../fixtures/documents";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** ZIP con muchas entradas del directorio apuntando al mismo bloque de 20 MB comprimido. */
function buildOverlappingZipBomb(entries: number): Uint8Array {
  const plain = Buffer.alloc(20_000_000, 0x20);
  const compressed = deflateRawSync(plain, { level: 9 });
  const crc = crc32(plain);
  const name = Buffer.from("word/document.xml");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(plain.length, 22);
  local.writeUInt16LE(name.length, 26);
  const body = Buffer.concat([local, name, compressed]);
  const directory: Buffer[] = [];
  for (let i = 0; i < entries; i++) {
    const entryName = Buffer.from(i === 0 ? "word/document.xml" : `word/p${i}.xml`);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(plain.length, 24);
    header.writeUInt16LE(entryName.length, 28);
    header.writeUInt32LE(0, 42);
    directory.push(header, entryName);
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries, 8);
  end.writeUInt16LE(entries, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(body.length, 16);
  return new Uint8Array(Buffer.concat([body, central, end]));
}

/** PDF con un stream binario aleatorio, como una foto JPEG incrustada. */
function pdfWithBinaryStream(size: number): Uint8Array {
  const head = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode >>\nstream\n");
  const tail = Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 2 0 R >>\n%%EOF\n");
  return new Uint8Array(Buffer.concat([head, randomBytes(size - head.length - tail.length), tail]));
}

const asFile = (bytes: Uint8Array, name: string, declaredType: string) => ({
  name,
  size: bytes.length,
  declaredType,
  bytes,
});

describe("validación de archivos de CV", () => {
  it("acepta PDF y DOCX válidos", async () => {
    const pdf = await makePdf(["Ana Ficticia", "Analista"]);
    expect(validateResumeFile(asFile(pdf, "cv.pdf", "application/pdf"))).toMatchObject({ ok: true, kind: "pdf" });
    const docx = makeDocx(["Ana Ficticia"]);
    expect(validateResumeFile(asFile(docx, "CV Ana.DOCX", DOCX_MIME))).toMatchObject({ ok: true, kind: "docx" });
  });

  it("rechaza extensiones no permitidas y tipos que no coinciden", async () => {
    const pdf = await makePdf(["x"]);
    expect(validateResumeFile(asFile(pdf, "cv.exe", "application/pdf")).ok).toBe(false);
    expect(validateResumeFile(asFile(pdf, "cv.pdf.exe", "application/pdf")).ok).toBe(false);
    expect(validateResumeFile(asFile(pdf, "cv.pdf", "text/html")).ok).toBe(false);
  });

  it("verifica el contenido real y no solo la extensión", () => {
    const fake = strToU8("<html><script>alert(1)</script></html>");
    const result = validateResumeFile(asFile(fake, "cv.pdf", "application/pdf"));
    expect(result).toEqual({ ok: false, reason: "El archivo no es un PDF válido." });
    expect(validateResumeFile(asFile(fake, "cv.docx", DOCX_MIME)).ok).toBe(false);
  });

  it("rechaza archivos vacíos, incompletos o mayores a 4 MB", () => {
    expect(validateResumeFile({ name: "cv.pdf", size: 0, declaredType: "application/pdf", bytes: new Uint8Array() }).ok).toBe(false);
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    expect(validateResumeFile(asFile(big, "cv.pdf", "application/pdf"))).toEqual({
      ok: false,
      reason: "El archivo supera el tamaño máximo de 4 MB.",
    });
    expect(validateResumeFile({ name: "cv.pdf", size: 10, declaredType: "application/pdf", bytes: new Uint8Array(5) }).ok).toBe(false);
  });

  it("rechaza PDF con contenido activo, incluso con nombres ofuscados", async () => {
    const base = new TextDecoder("latin1").decode(await makePdf(["x"]));
    const withJs = base.replace("%%EOF", "1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj\n%%EOF");
    const obfuscated = base.replace("%%EOF", "1 0 obj << /S /J#61vaScript >> endobj\n%%EOF");
    for (const content of [withJs, obfuscated]) {
      const bytes = new Uint8Array([...content].map((c) => c.charCodeAt(0)));
      const result = validateResumeFile(asFile(bytes, "cv.pdf", "application/pdf"));
      expect(result.ok).toBe(false);
    }
  });

  it("rechaza DOCX con macros, objetos incrustados o plantillas remotas", () => {
    for (const options of [{ macro: true }, { embedded: true }, { externalTemplate: true }]) {
      const result = validateResumeFile(asFile(makeDocx(["x"], options), "cv.docx", DOCX_MIME));
      expect(result.ok).toBe(false);
    }
  });

  it("aborta una zip bomb de entradas superpuestas antes de descomprimirla", () => {
    const bomb = buildOverlappingZipBomb(40);
    const started = Date.now();
    const result = validateResumeFile(asFile(bomb, "cv.docx", DOCX_MIME));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/anómalo/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("no confunde datos binarios de imágenes con contenido activo", () => {
    for (let i = 0; i < 100; i++) {
      const bytes = pdfWithBinaryStream(1024 * 1024);
      expect(validateResumeFile(asFile(bytes, "cv.pdf", "application/pdf")).ok).toBe(true);
    }
  }, 30_000);

  it("rechaza ZIP que no son documentos de Word", () => {
    const zipWithoutDocument = makeDocx(["x"]);
    // Un ZIP cualquiera con firma correcta pero sin word/document.xml
    const other = new Uint8Array(zipWithoutDocument);
    const text = new TextDecoder("latin1").decode(other).replaceAll("word/document.xml", "word/documenX.xml");
    const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0)));
    expect(validateResumeFile(asFile(bytes, "cv.docx", DOCX_MIME)).ok).toBe(false);
  });

  it("limpia nombres de archivo", () => {
    expect(sanitizeFileName("..\\..\\C:/temp/<cv>\u0000 final.pdf")).toBe("cv final.pdf");
    expect(sanitizeFileName(`${"a".repeat(300)}.docx`)).toHaveLength(120);
  });
});

describe("extracción de texto", () => {
  it("extrae texto de un PDF", async () => {
    const pdf = await makePdf(["Lucía Ficticia Rojas", "Correo: lucia.ficticia@correo.test", "Experiencia en SQL Server y Excel"]);
    const result = await extractResume(pdf, "pdf");
    expect(result.status).toBe("completada");
    expect(result.text).toContain("Lucía Ficticia Rojas");
    expect(result.suggestions.email?.value).toBe("lucia.ficticia@correo.test");
    expect(result.suggestions.skills.map((s) => s.value)).toEqual(expect.arrayContaining(["SQL Server", "Excel"]));
  });

  it("extrae texto de un DOCX, incluido el encabezado", async () => {
    const docx = makeDocx(
      ["Experiencia: 5 años como asistente contable.", "Herramientas: Concar, PLAME y Excel."],
      { header: "Jorge Ficticio Salas · +51 912 345 678" },
    );
    const result = await extractResume(docx, "docx");
    expect(result.status).toBe("completada");
    expect(result.text).toContain("Jorge Ficticio Salas");
    expect(result.text).toContain("asistente contable");
    expect(result.suggestions.phone?.value).toBe("+51 912 345 678");
  });

  it("indica 'sin texto' en documentos escaneados en lugar de inventar contenido", async () => {
    const result = await extractResume(await makeEmptyPdf(), "pdf");
    expect(result.status).toBe("sin_texto");
    expect(result.suggestions).toEqual({ skills: [], version: "sugerencias-v1" });
    expect(result.warnings.join(" ")).toContain("OCR");
  });

  it("informa documentos dañados sin lanzar excepciones", async () => {
    const result = await extractResume(strToU8("%PDF-1.7 dañado %%EOF"), "pdf");
    expect(result.status).toBe("fallida");
    expect(result.text).toBeNull();
  });
});

describe("extracción aislada en worker", () => {
  const pdf = strToU8("%PDF-1.7 prueba %%EOF");

  it("termina un trabajo que excede el plazo y devuelve 'fallida'", async () => {
    const started = Date.now();
    const result = await extractResume(pdf, "pdf", { timeoutMs: 300, testWorkerSource: "for (;;) {}" });
    expect(result.status).toBe("fallida");
    expect(result.errorCode).toBe("tiempo_agotado");
    expect(result.text).toBeNull();
    // Un bucle de CPU no se detiene con una promesa: solo terminate() lo corta.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("devuelve 'fallida' con 'recursos_agotados' si el worker agota la memoria", async () => {
    const source = "const hog = []; for (;;) hog.push(new Array(1e6).fill({ x: 1 }));";
    const result = await extractResume(pdf, "pdf", { timeoutMs: 15_000, testWorkerSource: source });
    expect(result.status).toBe("fallida");
    expect(result.errorCode).toBe("recursos_agotados");
  }, 30_000);

  it("devuelve 'fallida' con 'recursos_agotados' si se agota la pila", async () => {
    const source = "const { parentPort } = require('node:worker_threads'); try { (function f() { f(); })(); } catch (e) { parentPort.postMessage({ ok: false, exhausted: e instanceof RangeError }); }";
    const result = await extractResume(pdf, "pdf", { timeoutMs: 5_000, testWorkerSource: source });
    expect(result.errorCode).toBe("recursos_agotados");
  });

  it("devuelve 'lectura_fallida' si el worker termina sin responder", async () => {
    const result = await extractResume(pdf, "pdf", { timeoutMs: 5_000, testWorkerSource: "process.exit(0)" });
    expect(result.status).toBe("fallida");
    expect(result.errorCode).toBe("lectura_fallida");
  });
});

describe("sugerencias de datos", () => {
  it("no inventa datos ausentes", () => {
    expect(suggestFields("Persona con experiencia en ventas.")).toEqual({ skills: [] });
  });

  it("no confunde rangos de años con teléfonos", () => {
    expect(suggestFields("Trabajó entre 2015 - 2019 en Arequipa.").phone).toBeUndefined();
  });

  it("devuelve la evidencia de cada sugerencia", () => {
    const suggestions = suggestFields("Perfil: https://www.linkedin.com/in/perfil-ficticio y manejo de Power BI");
    expect(suggestions.linkedin_url?.value).toBe("https://www.linkedin.com/in/perfil-ficticio");
    expect(suggestions.skills[0]).toMatchObject({ value: "Power BI" });
    expect(suggestions.skills[0]!.evidence).toContain("Power BI");
  });
});
