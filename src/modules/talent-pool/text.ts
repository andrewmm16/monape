import { sanitizeSearchTerm } from "@/lib/search";

/**
 * Patrón `ilike` (`%término%`) sobre el texto tal cual; `ilike` ya ignora
 * mayúsculas. No iguala tildes distintas («cafe» no encuentra «café»).
 * // TODO: unaccent en BD (RPC) para igualar tildes
 * Devuelve "" si no queda ningún carácter literal buscable.
 */
export function accentInsensitivePattern(value: string): string {
  const term = sanitizeSearchTerm(value).toLowerCase();
  if (!term || !/[\p{L}\p{N}]/u.test(term)) return "";
  return `%${term}%`;
}

/** Normaliza igual que `private.normalize_person_name` (columna `name_normalized`). */
export function normalizeName(value: string): string {
  return sanitizeSearchTerm(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Divide "react, sql" en términos únicos y acotados. */
export function splitSkills(value: string): string[] {
  return [...new Set(value.split(",").map((s) => sanitizeSearchTerm(s)).filter(Boolean))].slice(0, 6);
}
