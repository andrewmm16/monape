import { chromium as playwrightChromium, type BrowserContext } from "@playwright/test";

/**
 * Motor de navegador. Por defecto usa **patchright** (reemplazo directo de la API de
 * Playwright que parchea las señales que delatan la automatización: `navigator.webdriver`,
 * plugins, WebGL, etc.), y si no está disponible cae en el Chromium normal de Playwright
 * (reversible y a prueba de fallos). Anti-detección = «evitar el captcha», la capa más
 * fiable (ver `docs/escalado-captcha.md`, Fase 2).
 */
async function chromiumAntideteccion(): Promise<typeof playwrightChromium> {
  if (process.env.BOT_STEALTH === "off") return playwrightChromium;
  try {
    // Especificador dinámico: patchright no publica tipos y su API es la de Playwright.
    const nombre = "patchright";
    const mod = (await import(nombre)) as { chromium?: typeof playwrightChromium; default?: { chromium?: typeof playwrightChromium } };
    return mod.chromium ?? mod.default?.chromium ?? playwrightChromium;
  } catch {
    return playwrightChromium;
  }
}

/**
 * Abre Chromium con un perfil persistente: las cookies de la sesión que una
 * persona inició a mano quedan en `profileDir`. El robot nunca escribe usuario
 * ni contraseña. Esa carpeta equivale a la sesión iniciada: no se comparte ni
 * se sube al repositorio. Cada cuenta/portal real debe usar su propio `profileDir`
 * (sesión y huella estables).
 */
export async function openSession(profileDir: string, headless: boolean, slowMo = 0): Promise<BrowserContext> {
  const chromium = await chromiumAntideteccion();
  return chromium.launchPersistentContext(profileDir, {
    headless,
    acceptDownloads: true,
    // Para ver el robot trabajar: retrasa cada acción (BOT_SLOWMO_MS).
    slowMo,
    viewport: { width: 1280, height: 800 },
  });
}
