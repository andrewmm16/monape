import { asksForHigherLevel, isFormationRequirement, requiredDegree } from "./rule-engine";
import { findTermOccurrences, normalizeForSearch, normalizeTerm, SHORT_TERM_MAX, termVariants } from "./text";
import type { RequirementInput } from "./types";

/**
 * Auditoría de los criterios de una vacante: responde «qué va a hacer el motor
 * con estos requisitos» ANTES de evaluar a nadie.
 *
 * El motor de reglas solo encuentra los términos que alguien escribió en la
 * vacante, así que la mayor parte de sus errores no están en el motor: están en
 * la configuración. Este módulo no inventa criterios de estilo; cada aviso
 * corresponde a un comportamiento medido o a una regla documentada del motor, y
 * se dice en el propio aviso cuál. Si una comprobación no puede explicar qué
 * hará el motor, no entra aquí.
 *
 * Es puro y determinista, y usa los predicados del propio motor
 * (`requiredDegree`, `asksForHigherLevel`, `isFormationRequirement`,
 * `SHORT_TERM_MAX`) en lugar de una copia: una auditoría que derive del motor
 * es peor que no tener auditoría, porque avisa de lo que ya no pasa y calla lo
 * que sí.
 */

export type Gravedad = "bloquea" | "riesgo" | "aviso";

export type Hallazgo = {
  requirementId: string;
  gravedad: Gravedad;
  /** Qué pasa, en términos de lo que hará el motor. */
  problema: string;
  /** Qué hacer. Siempre concreto y accionable. */
  sugerencia: string;
};

export const GRAVEDAD_ORDEN: Record<Gravedad, number> = { bloquea: 0, riesgo: 1, aviso: 2 };

export const GRAVEDAD_ETIQUETA: Record<Gravedad, string> = {
  bloquea: "El motor no podrá evaluarlo",
  riesgo: "Puede dar un resultado equivocado",
  aviso: "Se puede mejorar",
};

/** Alfanuméricos de un término normalizado: es la medida que usa el motor. */
function largoUtil(termino: string): number {
  return normalizeTerm(termino).replace(/[^\p{L}\p{N}]/gu, "").length;
}

function esCorto(termino: string): boolean {
  return largoUtil(termino) > 0 && largoUtil(termino) <= SHORT_TERM_MAX;
}

/**
 * Palabras tan frecuentes que como término coincidirían en casi cualquier CV.
 * No es una lista de estilo: el motor las encontraría y acreditaría el
 * requisito sin que el CV demuestre nada.
 */
const DEMASIADO_COMUN = new Set([
  "y", "o", "e", "u", "de", "del", "la", "el", "los", "las", "un", "una", "en", "con", "para", "por", "al",
  "experiencia", "conocimiento", "conocimientos", "manejo", "trabajo", "empresa", "persona", "area", "nivel",
]);

export function auditRequirement(requirement: RequirementInput): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const añadir = (gravedad: Gravedad, problema: string, sugerencia: string) =>
    hallazgos.push({ requirementId: requirement.id, gravedad, problema, sugerencia });

  const terminos = requirement.keywords.map((k) => k.trim()).filter((k) => k.length > 0);

  // 1. Sin términos no hay nada que buscar: el motor devuelve «pendiente de
  //    verificación» y el requisito queda fuera de la evaluación automática.
  if (terminos.length === 0) {
    añadir(
      "bloquea",
      "El requisito no tiene términos de búsqueda, así que el motor no puede evaluarlo y lo deja pendiente de verificación manual.",
      "Añada al menos un término que aparecería literalmente en el CV de alguien que cumple.",
    );
    return hallazgos;
  }

  // 2. Términos demasiado comunes: acreditarían a cualquiera.
  for (const termino of terminos) {
    if (DEMASIADO_COMUN.has(normalizeTerm(termino))) {
      añadir(
        "riesgo",
        `«${termino}» es una palabra de uso corriente: aparece en casi cualquier CV y acreditaría el requisito sin que el candidato demuestre nada.`,
        "Use el término concreto que distingue a quien cumple (una herramienta, una certificación, una función).",
      );
    }
  }

  const cortos = terminos.filter(esCorto);
  const largos = terminos.filter((t) => !esCorto(t));

  // 3. Un término de 1-2 caracteres solo cuenta escrito como sigla o exacto
  //    (regla del motor), y es el primero que se rompe en un CV escaneado:
  //    medido en el banco de OCR, «(B2)» se leyó «(82)».
  for (const corto of cortos) {
    const respaldoIndependiente = largos.filter(
      (largo) => !normalizeTerm(largo).includes(normalizeTerm(corto)),
    );
    if (largos.length === 0) {
      añadir(
        "riesgo",
        `«${corto}» tiene ${largoUtil(corto)} caracteres: el motor solo lo cuenta escrito como sigla en mayúsculas o exactamente igual, y en un CV escaneado un solo carácter mal leído lo hace desaparecer.`,
        `Añada un término largo que NO contenga «${corto}» (por ejemplo la forma desarrollada del concepto).`,
      );
    } else if (respaldoIndependiente.length === 0) {
      añadir(
        "riesgo",
        `Todos los términos largos de este requisito contienen «${corto}», así que un solo carácter mal leído los tumba a la vez. Es exactamente el caso medido en el banco de CV escaneados: «Inglés intermedio (B2)» se leyó «Inglés intermedio (82)» y cayeron los dos términos.`,
        `Añada un término largo sin «${corto}» dentro, como respaldo real.`,
      );
    }
  }

  // 4. Un término que ya coincidiría dentro de otro hace redundante al segundo.
  //    OJO: no vale comparar cadenas. El motor exige límite de palabra en los
  //    extremos alfanuméricos, así que «AFP» NO coincide dentro de «AFPnet» y
  //    quitar «AFPnet» perdería cobertura; «SAP» sí coincide dentro de «SAP MM».
  //    La única forma correcta de decidirlo es preguntárselo al motor con su
  //    propia búsqueda, variantes de flexión incluidas.
  for (const a of terminos) {
    for (const b of terminos) {
      if (a === b || esCorto(a)) continue;
      if (normalizeTerm(a).length >= normalizeTerm(b).length) continue;
      const dentroDeB = normalizeForSearch(b);
      const yaCoincide = termVariants(a).some((variante) => findTermOccurrences(dentroDeB, variante, 1).length > 0);
      if (yaCoincide) {
        añadir(
          "aviso",
          `«${b}» no añade nada: el motor busca cada término por separado y «${a}» ya coincide dentro de él.`,
          `Puede quitar «${b}» para dejar la configuración más clara.`,
        );
      }
    }
  }

  // 5. Formación sin grado nombrado en la DESCRIPCIÓN: la escalera de grados
  //    del motor lee la descripción, no los términos.
  if (requirement.minYears === null && isFormationRequirement(requirement) && requiredDegree(requirement.description) === null) {
    añadir(
      "aviso",
      "La descripción no nombra ningún grado académico, así que el motor no distinguirá un egresado de un titulado: acreditará cualquiera de los dos.",
      "Si el puesto exige un grado concreto, escríbalo en la descripción («título profesional», «bachiller», «estudios técnicos»).",
    );
  }

  // 6. Nivel exigido solo en los términos y no en la descripción: la regla de
  //    nivel del motor también lee la descripción.
  const nivelEnTerminos = terminos.some((t) =>
    /\b(?:avanzad[oa]|intermedi[oa]|experto|senior|advanced|intermediate)\b/.test(normalizeTerm(t)),
  );
  if (nivelEnTerminos && !asksForHigherLevel(requirement)) {
    añadir(
      "riesgo",
      "Los términos piden un nivel (avanzado o intermedio) pero la descripción no, y el motor lee el nivel exigido en la DESCRIPCIÓN: no rechazará a quien declare nivel básico.",
      "Escriba el nivel en la descripción del requisito, por ejemplo «Excel nivel avanzado».",
    );
  }

  return hallazgos;
}

export type AuditoriaVacante = {
  hallazgos: Hallazgo[];
  /** Peso de los requisitos marcados como legales o esenciales, en % del total. */
  pesoEsencial: number;
};

export function auditRequirements(requirements: RequirementInput[]): AuditoriaVacante {
  const hallazgos = requirements
    .flatMap(auditRequirement)
    .sort((a, b) => GRAVEDAD_ORDEN[a.gravedad] - GRAVEDAD_ORDEN[b.gravedad]);

  const total = requirements.reduce((suma, r) => suma + r.weight, 0);
  const esencial = requirements.filter((r) => r.isEssential).reduce((suma, r) => suma + r.weight, 0);
  const pesoEsencial = total > 0 ? Math.round((esencial * 1000) / total) / 10 : 0;

  // 7. Un requisito legal o esencial SIEMPRE queda pendiente de verificación,
  //    por diseño. Si cubren la mayor parte del peso, ninguna evaluación
  //    llegará a «cumple los requisitos» y el nivel pierde utilidad.
  if (pesoEsencial > 50) {
    hallazgos.push({
      requirementId: "",
      gravedad: "aviso",
      problema: `Los requisitos marcados como legales o esenciales son el ${pesoEsencial} % del peso, y el motor los deja siempre pendientes de verificación: ninguna evaluación podrá superar el ${(100 - pesoEsencial).toFixed(0)} % y todas quedarán en «faltan datos».`,
      sugerencia: "Marque como esencial solo lo que de verdad exija un documento antes de decidir (colegiatura, licencia, antecedentes).",
    });
  }

  return { hallazgos, pesoEsencial };
}
