/**
 * Conector de búsqueda de correo del Reclutador Caleta.
 *
 * Dado un nombre, un apellido y el dominio de una empresa, genera los formatos
 * estándar de correo corporativo y los contrasta con `verifyProvidedEmail`,
 * devolviendo los que pasan la comprobación de entregabilidad.
 *
 * ⚠️ Límite real de esta comprobación (léelo antes de confiar en el resultado):
 * `verifyProvidedEmail` solo resuelve los registros **MX del dominio**, no el
 * buzón concreto. Como las 6 permutaciones comparten el mismo `dominioEmpresa`,
 * en una empresa con correo activo las 6 saldrán `entregable` por igual: esto
 * confirma que «el dominio recibe correo», NO cuál de las direcciones existe de
 * verdad. Para discriminar el buzón real haría falta un sondeo SMTP (RCPT TO),
 * que este módulo evita a propósito por fiabilidad y reputación de IP.
 */

import { generateEmailAliases } from "../../utils/alias-generator";
import { verifyProvidedEmail } from "./email-verification";

/**
 * Genera las direcciones candidatas para una persona en un dominio y devuelve
 * las que superan la comprobación de entregabilidad (dominio con MX válido).
 *
 * @param nombre Nombre de pila del candidato.
 * @param apellido Apellido(s) del candidato.
 * @param dominioEmpresa Dominio corporativo, p. ej. `ecoplaza.com.pe`.
 * @returns Correos normalizados cuyo dominio acepta correo. Puede devolver
 *   varias (o todas) las permutaciones: ver la advertencia del encabezado.
 */
export async function encontrarCorreosValidos(
  nombre: string,
  apellido: string,
  dominioEmpresa: string,
): Promise<string[]> {
  // 1. Genera los 6 formatos estándar (ej. juan.perez@empresa.com.pe).
  const candidatos = generateEmailAliases(nombre, apellido, dominioEmpresa);

  const entregables: string[] = [];

  // 2. Comprueba cada candidato contra los registros MX del dominio.
  for (const correo of candidatos) {
    const resultado = await verifyProvidedEmail(correo);
    if (resultado.status === "entregable" && resultado.normalized !== null) {
      entregables.push(resultado.normalized);
    }
  }

  return entregables;
}
