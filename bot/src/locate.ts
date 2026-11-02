import type { Locator, Page } from "@playwright/test";
import { ERROR_CODES, PortalError } from "./errors";

/** Una forma de encontrar el elemento; la primera que funcione se usa. */
export type Strategy = (page: Page) => Locator;

export interface FindOptions {
  /** Tiempo máximo por cada alternativa. */
  timeoutMs?: number;
  /** Se llama cuando solo funcionó una alternativa (no la primera): el portal cambió algo pequeño. */
  onFallback?: (description: string, used: number) => void;
}

/**
 * Busca un elemento por varias vías (rol, etiqueta, texto, sinónimos…), de la más
 * estable a la menos. Si ninguna funciona lanza `pagina_cambio`; si funciona una
 * que no es la primera, avisa con `onFallback` para corregir el adaptador antes de
 * que se rompa del todo. Nunca inventa selectores: cada adaptador declara los suyos.
 */
export async function findElement(
  page: Page,
  description: string,
  strategies: Strategy[],
  { timeoutMs = 3_000, onFallback }: FindOptions = {},
): Promise<Locator> {
  for (let index = 0; index < strategies.length; index++) {
    const locator = strategies[index](page).first();
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
    } catch {
      continue;
    }
    if (index > 0) onFallback?.(description, index);
    return locator;
  }
  throw new PortalError(ERROR_CODES.pageChanged, `No se encontró «${description}» (se probaron ${strategies.length} formas).`);
}
