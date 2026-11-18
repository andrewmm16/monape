import { RELATED_GROUPS } from "./related";
import { normalizeTerm } from "./text";
import type { ItemAssessment, RequirementInput } from "./types";

/**
 * Negaciones explícitas del CV («sin experiencia en reclamos», «no cuento con
 * experiencia en planillas, ni en PLAME», «no manejo SAP») que se refieren a un
 * requisito aunque no usen sus palabras clave exactas (reglas-v12).
 *
 * El motor NO descarta a nadie: el requisito queda como estaba, con la marca de
 * duda «negacion_explicita» y la cita en el motivo, para que la IA lo confirme
 * (y, si confirma «no cumple» con esa cita, el relevo lo aplica). Medido con la
 * app real el 18/11/2026: los 5 «no cumple» explícitos que el motor no veía.
 */

export type ExplicitNegation = {
  /** La línea del CV, tal cual (para citar). */
  quote: string;
  /** Palabras de lo negado, normalizadas («reclamos», «plame»). */
  words: string[];
};

// Sobre texto normalizado (minúsculas, sin tildes). Lo negado va hasta la próxima
// puntuación o «pero/aunque» (cada «ni en X» es su propia negación).
const NEGATION = new RegExp(
  String.raw`(?:^|[^a-z0-9])(?:sin (?:experiencia|conocimientos?|manejo|formacion|estudios|practica)|no (?:cuento con|tengo|manejo|domino|conozco|he (?:trabajado|usado|manejado|tenido|llevado))|ni (?:en|con|de)|desconozco|carezco de)\b([^.;:,()\n•]{2,80})`,
  "g",
);
const CLAUSE_END = /\s(?:pero|aunque|sin embargo|salvo|excepto)\s.*$/;

/** Palabras que no identifican un requisito («experiencia en», «nivel», «gestión»…). */
const STOPWORDS = new Set(
  (
    "experiencia conocimiento conocimientos manejo formacion estudios practica previa previo laboral laborales profesional " +
    "minimo minima anos ano meses nivel avanzado intermedio basico basica buen buena buenos alto alta uso trabajo area " +
    "sector empresa empresas gestion herramientas herramienta capacidad habilidad habilidades dominio puesto puestos " +
    "como para con del las los una uno sus por que esta este sobre tipo otros otras general"
  ).split(" "),
);

const tokens = (text: string, minLength: number) =>
  normalizeTerm(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= minLength && !STOPWORDS.has(w));

/** Raíz corta para emparejar «programación» con «programador», «contable» con «contabilidad». */
const stem = (w: string) => (w.length >= 6 ? w.slice(0, 6) : w);

/**
 * Negaciones explícitas del CV, línea por línea: un salto de línea corta lo negado
 * («Sin experiencia en ventas↵CRM: Zendesk» no niega el CRM). Pero el PDF corta
 * las frases largas en varias líneas («No cuento↵con experiencia en planillas»):
 * una línea que empieza en minúscula es la continuación de la anterior.
 */
export function findExplicitNegations(original: string): ExplicitNegation[] {
  const found: ExplicitNegation[] = [];
  const joined = original.replace(/[^\S\r\n]*\r?\n[^\S\r\n]*(?=\p{Ll})/gu, " ");
  for (const line of joined.split(/\r?\n/)) {
    const normalized = normalizeTerm(line);
    if (!/\b(?:sin|no|ni|desconozco|carezco)\b/.test(normalized)) continue;
    NEGATION.lastIndex = 0;
    for (let m = NEGATION.exec(normalized); m !== null; m = NEGATION.exec(normalized)) {
      const object = m[1]!.replace(CLAUSE_END, "");
      const words = tokens(object, 3);
      if (words.length > 0) found.push({ quote: line.trim().slice(0, 200), words });
    }
  }
  return found;
}

/** La negación que se refiere a este requisito (por sus palabras clave o su descripción), o null. */
export function negationFor(requirement: Pick<RequirementInput, "description" | "keywords">, negations: ExplicitNegation[]): ExplicitNegation | null {
  if (negations.length === 0) return null;
  // Palabras clave: desde 3 letras (siglas como CRM, SAP, IGV). Descripción: desde 5.
  // Más la familia del puesto de la lista revisada de cargos (related.ts): «programación»
  // niega «desarrollador» porque «programador» es de la misma familia.
  const words = [...requirement.keywords.flatMap((k) => tokens(k, 3)), ...tokens(requirement.description, 5)];
  const family = RELATED_GROUPS.filter((g) => g.pedidos.some((p) => tokens(p, 3).some((t) => words.includes(t))));
  const own = new Set([...words, ...family.flatMap((g) => g.pedidos.flatMap((p) => tokens(p, 3)))].map(stem));
  return negations.find((n) => n.words.some((w) => own.has(stem(w)))) ?? null;
}

/**
 * Marca la duda en la valoración del motor si el CV niega expresamente el
 * requisito. No toca lo acreditado (hay evidencia a favor en otra parte) ni lo
 * resuelto por una regla aprendida; nunca cambia la valoración.
 */
export function markExplicitNegation(
  item: ItemAssessment,
  requirement: Pick<RequirementInput, "description" | "keywords">,
  negations: ExplicitNegation[],
): ItemAssessment {
  if (item.assessment === "acreditado" || item.resolvedBy || item.cvAssessment) return item;
  const negation = negationFor(requirement, negations);
  if (!negation) return item;
  return {
    ...item,
    signal: "negacion_explicita",
    rationale: `${item.rationale} El CV dice expresamente: «${negation.quote}». Si se refiere a este requisito, no lo cumple: confírmelo.`,
  };
}
