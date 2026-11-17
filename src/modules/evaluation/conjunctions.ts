import { normalizeTerm } from "./text";

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
