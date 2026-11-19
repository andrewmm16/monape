import { conjunctGroups, conjunctTerms, joinsWithAnd, namedInDescription } from "@/modules/evaluation/conjunctions";
import type { RequirementInput } from "@/modules/evaluation/types";
import { splitKeywords } from "./term-suggestions";

/**
 * Aviso del formulario de requisitos cuando la descripción une términos con «y».
 *  - `exige_todos`: el motor exige todos, y con uno solo el requisito queda
 *    pendiente. Pasa con siglas o nombres propios («S10 y MS Project») y, desde
 *    reglas-v16, con dos frases de contenido propio que tienen cada una sus
 *    términos («matriz IPERC e investigación de accidentes»). Se informa.
 *  - `separar`: nombres comunes de un mismo dominio («contabilidad y finanzas»);
 *    el motor da por cumplido el requisito con uno solo. Si son cosas distintas,
 *    conviene crearlas como requisitos separados.
 */
export type CompoundHint = { tipo: "exige_todos" | "separar"; terminos: string[] };

/**
 * Aviso para la descripción y los términos del formulario, o null si no aplica.
 * La categoría sigue la misma regla que el motor: en formación, idiomas y
 * competencias las frases con «y» no se exigen a la vez.
 */
export function requirementCompoundHint(
  description: string,
  keywords: string,
  category?: RequirementInput["category"],
): CompoundHint | null {
  if (!joinsWithAnd(description)) return null;
  const terminos = splitKeywords(keywords);
  const todos = conjunctTerms(description, terminos);
  if (todos.length >= 2) return { tipo: "exige_todos", terminos: todos };
  const frases = category === "formacion" || category === "idioma" || category === "competencia" ? [] : conjunctGroups(description, terminos);
  if (frases.length >= 2) return { tipo: "exige_todos", terminos: frases.map((grupo) => grupo[0]!) };
  const nombrados = namedInDescription(description, terminos);
  return nombrados.length >= 2 ? { tipo: "separar", terminos: nombrados } : null;
}
