/**
 * Ciudad y región para mostrar: omite la región cuando es igual a la ciudad
 * (p. ej. «Lima» en ambas) para no terminar con «Lima, Lima».
 */
export function formatCityRegion(city: string | null | undefined, region: string | null | undefined): string {
  const c = city?.trim() ?? "";
  const r = region?.trim() ?? "";
  if (c && r && c.toLocaleLowerCase("es-PE") === r.toLocaleLowerCase("es-PE")) return c;
  return [c, r].filter(Boolean).join(", ");
}
