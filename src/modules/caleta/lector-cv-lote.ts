import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { extractRawText, type ResumeFileKind } from "@/modules/resumes/extraction-core";
import { suggestFields, suggestName } from "@/modules/resumes/suggestions";

/**
 * Lector de CVs en lote para Caleta.
 *
 * Trabaja sobre PDFs/DOCX que ya obran en poder del proceso (los candidatos los
 * aportaron al postular, o se cargaron a mano desde `cv-prueba/`). NO descarga
 * ni rastrea nada de internet: la fuente es una carpeta local y cada archivo se
 * procesa de forma aislada.
 *
 * Reutiliza las funciones de extracción que ya usa la aplicación en la carga
 * masiva de CV, de modo que el resultado de este lote coincide con lo que vería
 * RRHH en pantalla:
 *   - `extractRawText`  -> texto del PDF/DOCX (unpdf / mammoth)
 *   - `suggestFields`   -> correo, teléfono, LinkedIn y habilidades detectadas
 *   - `suggestName`     -> nombre aproximado del candidato
 *
 * Todo lo que devuelve es una SUGERENCIA con su evidencia. No registra, no
 * contacta y no decide nada: es material para que una persona lo revise.
 */

export const LECTOR_CV_LOTE_VERSION = "lector-cv-lote-v1";

const EXTENSIONES: Record<string, ResumeFileKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
};

export type CandidatoCv = {
  /** Ruta del archivo relativa a la carpeta de entrada. */
  archivo: string;
  nombre: string | null;
  correo: string | null;
  /** Teléfono tal como aparece en el CV (sin normalizar). */
  telefono: string | null;
  /** Celular de Perú normalizado a 9 dígitos (9XXXXXXXX) si el teléfono encaja; si no, null. */
  celularPeru: string | null;
  linkedin: string | null;
  habilidades: string[];
  /** Apto para la siguiente etapa cuando hay al menos una vía de contacto (correo o teléfono). */
  apto: boolean;
  /** Longitud del texto extraído; 0 suele indicar un PDF escaneado sin OCR. */
  caracteres: number;
  /** Fragmentos del CV que respaldan cada dato detectado. */
  evidencias: {
    nombre?: string;
    correo?: string;
    telefono?: string;
    linkedin?: string;
  };
};

export type ErrorLote = {
  archivo: string;
  error: string;
};

export type ResultadoLote = {
  version: string;
  generadoEn: string;
  entrada: string;
  totales: {
    archivos: number;
    candidatos: number;
    aptos: number;
    conCelularPeru: number;
    errores: number;
  };
  candidatos: CandidatoCv[];
  errores: ErrorLote[];
};

/**
 * Normaliza un teléfono a un celular de Perú de 9 dígitos que empieza por 9.
 * Acepta separadores, paréntesis y el prefijo internacional +51 / 51. Devuelve
 * `null` si no corresponde a un celular peruano (fijos, extranjeros, años...).
 */
export function normalizarCelularPeru(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digitos = raw.replace(/\D/g, "");
  if (digitos.length === 11 && digitos.startsWith("51")) digitos = digitos.slice(2);
  if (digitos.length === 9 && digitos.startsWith("9")) return digitos;
  return null;
}

/** Deriva el tipo de archivo soportado a partir de la extensión, o `null` si no lo es. */
export function tipoDeArchivo(ruta: string): ResumeFileKind | null {
  return EXTENSIONES[extname(ruta).toLowerCase()] ?? null;
}

/**
 * Analiza el texto ya extraído de un CV y devuelve el candidato estructurado.
 * Función pura (sin E/S): facilita las pruebas y permite reusarla con texto que
 * venga de otra fuente (p. ej. el worker de la app o un OCR previo).
 */
export function analizarCvTexto(texto: string, archivo: string): CandidatoCv {
  const campos = suggestFields(texto);
  const nombre = suggestName(texto);

  const correo = campos.email?.value ?? null;
  const telefono = campos.phone?.value ?? null;
  const linkedin = campos.linkedin_url?.value ?? null;

  return {
    archivo,
    nombre: nombre?.value ?? null,
    correo,
    telefono,
    celularPeru: normalizarCelularPeru(telefono),
    linkedin,
    habilidades: campos.skills.map((s) => s.value),
    apto: Boolean(correo || telefono),
    caracteres: texto.length,
    evidencias: {
      nombre: nombre?.evidence,
      correo: campos.email?.evidence,
      telefono: campos.phone?.evidence,
      linkedin: campos.linkedin_url?.evidence,
    },
  };
}

/** Lee un único CV del disco y lo analiza. Lanza si el archivo no es PDF/DOCX o no se puede leer. */
export async function procesarArchivoCv(ruta: string, base: string): Promise<CandidatoCv> {
  const kind = tipoDeArchivo(ruta);
  if (!kind) throw new Error(`extensión no soportada: ${extname(ruta) || "(sin extensión)"}`);
  const bytes = new Uint8Array(await readFile(ruta));
  const texto = await extractRawText(bytes, kind);
  return analizarCvTexto(texto, relative(base, ruta) || ruta);
}

/** Lista, de forma recursiva y ordenada, los CVs (PDF/DOCX) dentro de una carpeta. */
export async function listarCvs(entrada: string): Promise<string[]> {
  const rutas: string[] = [];
  async function recorrer(dir: string): Promise<void> {
    const entradas = await readdir(dir, { withFileTypes: true });
    for (const e of entradas) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) await recorrer(ruta);
      else if (e.isFile() && tipoDeArchivo(ruta)) rutas.push(ruta);
    }
  }
  await recorrer(entrada);
  rutas.sort((a, b) => a.localeCompare(b, "es"));
  return rutas;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type OpcionesLote = {
  /** Carpeta local con los CVs (se recorre de forma recursiva). */
  entrada: string;
  /**
   * Pausa opcional entre archivos, en ms. No es necesaria con archivos locales
   * (no hay servidor que saturar); se expone solo como cortesía/throttle.
   */
  pausaMs?: number;
  /** Callback de progreso por cada archivo procesado o fallido. */
  onProgreso?: (evento: { indice: number; total: number; candidato?: CandidatoCv; error?: ErrorLote }) => void;
};

/**
 * Procesa todos los CVs de una carpeta. Cada archivo va en su propio try/catch:
 * si uno falla (archivo corrupto, PDF escaneado ilegible, etc.) se registra el
 * error y el lote continúa con el siguiente, sin abortar.
 */
export async function leerCvLote(opciones: OpcionesLote): Promise<ResultadoLote> {
  const { entrada, pausaMs = 0, onProgreso } = opciones;
  const archivos = await listarCvs(entrada);

  const candidatos: CandidatoCv[] = [];
  const errores: ErrorLote[] = [];

  for (let i = 0; i < archivos.length; i++) {
    const ruta = archivos[i]!;
    try {
      const candidato = await procesarArchivoCv(ruta, entrada);
      candidatos.push(candidato);
      onProgreso?.({ indice: i, total: archivos.length, candidato });
    } catch (e) {
      const error: ErrorLote = { archivo: relative(entrada, ruta) || ruta, error: mensajeError(e) };
      errores.push(error);
      onProgreso?.({ indice: i, total: archivos.length, error });
    }
    if (pausaMs > 0 && i < archivos.length - 1) await esperar(pausaMs);
  }

  return {
    version: LECTOR_CV_LOTE_VERSION,
    generadoEn: new Date().toISOString(),
    entrada,
    totales: {
      archivos: archivos.length,
      candidatos: candidatos.length,
      aptos: candidatos.filter((c) => c.apto).length,
      conCelularPeru: candidatos.filter((c) => c.celularPeru).length,
      errores: errores.length,
    },
    candidatos,
    errores,
  };
}

function mensajeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
