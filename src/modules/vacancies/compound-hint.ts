import { conjunctTerms, joinsWithAnd, namedInDescription } from "@/modules/evaluation/conjunctions";
import { splitKeywords } from "./term-suggestions";

/**
 * Aviso del formulario de requisitos cuando la descripción une términos con «y».
 *  - `exige_todos`: son siglas o nombres propios («S10 y MS Project»); el motor ya
 *    exige todos, y con uno solo el requisito queda pendiente. Se informa.
 *  - `separar`: son nombres comunes («contabilidad y finanzas»); el motor da por
 *    cumplido el requisito con uno solo, porque suelen ser un mismo dominio. Si son
 *    cosas distintas, conviene crearlas como requisitos separados.
 */
export type CompoundHint = { tipo: "exige_todos" | "separar"; terminos: string[] };

/** Aviso para la descripción y los términos del formulario, o null si no aplica. */
export function requirementCompoundHint(description: string, keywords: string): CompoundHint | null {
  if (!joinsWithAnd(description)) return null;
  const terminos = splitKeywords(keywords);
  const todos = conjunctTerms(description, terminos);
  if (todos.length >= 2) return { tipo: "exige_todos", terminos: todos };
  const nombrados = namedInDescription(description, terminos);
  return nombrados.length >= 2 ? { tipo: "separar", terminos: nombrados } : null;
}
