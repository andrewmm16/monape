import { findTermOccurrences, normalizeForSearch, normalizeTerm, termVariants } from "./text";

/**
 * Conjunciones en la descripción de un requisito. «y»/«e»/«and»/«&» unen ítems que
 * el puesto pide a la vez; «o»/«u»/«or» los presentan como alternativas.
 *
 * Módulo puro y sin dependencias de servidor: lo usan el motor de reglas (para
 * decidir el veredicto) y el formulario de requisitos (para avisar a RRHH), de modo
 * que lo que se avisa al configurar coincide con lo que el motor hace al evaluar.
 */
const AND_CONJ = /\s(?:y|e|and)\s|&/;
const OR_CONJ = /\s(?:o|u|or)\s/;

/** La descripción une ítems con «y» y no ofrece alternativas con «o». */
export function joinsWithAnd(description: string): boolean {
  const desc = normalizeTerm(description);
  return AND_CONJ.test(desc) && !OR_CONJ.test(desc);
}

/** Términos que aparecen escritos en la descripción del requisito. */
export function namedInDescription(description: string, terms: string[]): string[] {
  const desc = normalizeTerm(description);
  return terms.filter((t) => desc.includes(normalizeTerm(t)));
}

/**
 * Términos que la descripción exige A LA VEZ. Un requisito es conjuntivo cuando su
 * descripción enumera dos o más de sus términos unidos por «y» y no por «o»:
 * «S10 y MS Project» pide ambos; «WMS o ERP (SAP)» pide cualquiera. Devuelve esos
 * términos, o [] si no aplica (entonces basta uno).
 *
 * Solo cuentan como ítems distintos los que parecen una herramienta o sistema
 * propio (sigla, nombre con mayúscula o con dígito): «S10», «MS Project», «PLE»,
 * «T-Registro». Dos nombres comunes en minúscula unidos por «y» («planillas y
 * remuneraciones», «facturas y boletas») suelen ser un mismo dominio, y tratarlos
 * como dos requisitos bajaría de más. Cuando sí son cosas distintas, lo correcto es
 * crearlos como requisitos separados (el formulario lo sugiere).
 */
export function conjunctTerms(description: string, terms: string[]): string[] {
  if (!joinsWithAnd(description)) return [];
  const nombrados = namedInDescription(description, terms).filter((t) => /[A-Z0-9]/.test(t));
  return nombrados.length >= 2 ? nombrados : [];
}

// Partes de una enumeración: «A, B y C».
const PART_BREAK = /\s(?:y|e|and)\s|&|[,;]/;
// Palabras que no dan contenido propio a una parte.
const FILLER = new Set(["del", "las", "los", "con", "para", "por", "una", "unos", "unas", "sus", "que", "the", "and"]);
const contentWords = (part: string) => part.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !FILLER.has(w)).length;

/**
 * Grupos de términos que la descripción pide A LA VEZ con nombres comunes
 * (reglas-v16, banco ciego 2): «Elaboración de matriz IPERC e investigación de
 * accidentes», «Capacitación en primeros auxilios y uso de extintores». Cada
 * grupo son los términos configurados que aparecen escritos en una de las
 * partes; con uno de cada grupo se cumple.
 *
 * Solo cuando RRHH puso términos para dos partes o más y CADA una es una frase
 * con contenido propio (dos palabras o más). Así «Planillas y remuneraciones» o
 * «Contabilidad y finanzas», que suelen ser un mismo dominio, siguen cumpliéndose
 * con uno (ver conjunctTerms). Devuelve [] si no aplica.
 */
export function conjunctGroups(description: string, terms: string[]): string[][] {
  if (!joinsWithAnd(description)) return [];
  const parts = normalizeTerm(description)
    .split(PART_BREAK)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  const asignados = new Set<string>();
  const grupos = parts
    .map((part) => {
      const enLaParte = normalizeForSearch(part);
      const propios = terms.filter(
        (t) => !asignados.has(t) && termVariants(t).some((v) => findTermOccurrences(enLaParte, v, 1).length > 0),
      );
      propios.forEach((t) => asignados.add(t));
      return { part, propios };
    })
    .filter((g) => g.propios.length > 0);
  if (grupos.length < 2 || grupos.some((g) => contentWords(g.part) < 2)) return [];
  return grupos.map((g) => g.propios);
}
