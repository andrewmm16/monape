/**
 * Generación de alias de correo corporativo.
 *
 * Utilidad pura (sin efectos, sin I/O) para sugerir direcciones de correo al
 * dar de alta nuevos usuarios. No comprueba disponibilidad: solo construye los
 * formatos candidatos; la verificación contra los correos ya existentes es
 * responsabilidad de quien la invoque.
 */

/** Quita tildes/diacríticos, pasa a minúsculas y deja solo `[a-z0-9]`. */
function normalizeToken(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Normaliza el dominio: minúsculas, sin espacios ni un `@` inicial. */
function normalizeDomain(companyDomain: string): string {
  return companyDomain.trim().toLowerCase().replace(/^@+/, "");
}

/**
 * Devuelve hasta 6 formatos estándar de correo corporativo para un candidato,
 * limpios de tildes y en minúsculas, listos para ofrecer como sugerencia.
 *
 * Formatos (en orden): `nombre.apellido`, `inicial+apellido`,
 * `nombre_apellido`, `nombreapellido`, `apellido.nombre`, `nombre+inicial`.
 *
 * Si falta el nombre, el apellido o el dominio, devuelve `[]`. El resultado se
 * deduplica conservando el orden (nombres o apellidos de una sola letra pueden
 * colapsar algunos formatos), por lo que puede contener menos de 6 entradas.
 *
 * @param firstName Nombre de pila (puede ser compuesto: «Juan Carlos»).
 * @param lastName Apellido(s) (puede ser compuesto: «De la Cruz»).
 * @param companyDomain Dominio corporativo, p. ej. `ecoplaza.com.pe`.
 */
export function generateEmailAliases(
  firstName: string,
  lastName: string,
  companyDomain: string,
): string[] {
  const first = normalizeToken(firstName);
  const last = normalizeToken(lastName);
  const domain = normalizeDomain(companyDomain);

  if (!first || !last || !domain) return [];

  const firstInitial = first[0]!;
  const lastInitial = last[0]!;

  const locals = [
    `${first}.${last}`, // nombre.apellido
    `${firstInitial}${last}`, // inicial+apellido
    `${first}_${last}`, // nombre_apellido
    `${first}${last}`, // nombreapellido
    `${last}.${first}`, // apellido.nombre
    `${first}${lastInitial}`, // nombre+inicial
  ];

  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const local of locals) {
    const alias = `${local}@${domain}`;
    if (seen.has(alias)) continue;
    seen.add(alias);
    aliases.push(alias);
  }

  return aliases;
}
