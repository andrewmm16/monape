import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * User-Agent de escritorio. Se fija para pedir la maqueta de escritorio (los
 * selectores de `selectors.ts` apuntan a esa versión, no a la móvil), NO para
 * ocultar que es un navegador automatizado.
 */
const UA_ESCRITORIO =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface Sesion {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/** Abre Chromium headless con el User-Agent de escritorio y un viewport de escritorio. */
export async function abrirNavegador(headless = true): Promise<Sesion> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: UA_ESCRITORIO,
    viewport: { width: 1366, height: 900 },
    locale: "es-PE",
  });
  const page = await context.newPage();
  return { browser, context, page };
}

export async function cerrarNavegador(sesion: Sesion): Promise<void> {
  await sesion.context.close().catch(() => undefined);
  await sesion.browser.close().catch(() => undefined);
}
