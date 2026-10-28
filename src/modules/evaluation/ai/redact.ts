/**
 * Minimización de datos antes de enviar un CV a un proveedor de IA: se
 * reemplazan correos, teléfonos, enlaces y números de documento, que no son
 * necesarios para valorar requisitos del puesto.
 *
 * Limitación conocida: no elimina nombres propios ni direcciones postales.
 */
const PATTERNS: [RegExp, string][] = [
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, "[correo]"],
  [/\b(?:https?:\/\/|www\.)[^\s<>"]+/gi, "[enlace]"],
  [/\b(?:linkedin\.com|github\.com)\/[^\s<>"]+/gi, "[enlace]"],
  [/\b(?:dni|d\.n\.i\.|documento de identidad|carn[eé] de extranjer[ií]a|pasaporte|ruc)\s*(?:n[°º.o]*\s*)?[:#-]?\s*[A-Z0-9-]{6,15}/gi, "[documento]"],
  // Secuencias de 7 a 15 dígitos con separadores habituales de teléfonos.
  [/(?<![\p{L}\p{N}])\+?\(?\d[\d\s().-]{5,18}\d(?![\p{L}\p{N}])/gu, "[número]"],
];

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

export function redactContactData(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (replacement === "[número]") {
        const digits = digitCount(match);
        // Conserva años y rangos de fechas (p. ej. "2019 - 2023").
        if (digits < 7 || digits > 15 || /^\s*(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}\s*$/.test(match)) return match;
      }
      return replacement;
    });
  }
  return result;
}
