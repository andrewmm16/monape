/**
 * Limpia un término de búsqueda para filtros `ilike` de PostgREST: elimina
 * comodines y caracteres con significado sintáctico en `or=(...)`.
 */
export function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/[%_*,()\\:"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
