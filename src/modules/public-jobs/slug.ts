const MAX_SLUG_LENGTH = 80;

/** Título en minúsculas, sin tildes ni símbolos, unido con guiones. */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "vacante";
}

/** Segmento de la dirección: `<título-normalizado>-<código>`. */
export function buildJobSlug(title: string, code: string): string {
  return `${slugifyTitle(title)}-${code}`;
}

export function jobPath(title: string, code: string): string {
  return `/empleos/${buildJobSlug(title, code)}`;
}

/** Extrae el código (10 caracteres [a-z0-9]) al final de la dirección, o null. */
export function parseJobSlug(slug: string): string | null {
  const match = /-([a-z0-9]{10})$/.exec(slug);
  return match ? match[1]! : null;
}
