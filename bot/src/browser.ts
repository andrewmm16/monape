import { chromium, type BrowserContext } from "@playwright/test";

/**
 * Abre Chromium con un perfil persistente: las cookies de la sesión que una
 * persona inició a mano quedan en `profileDir`. El robot nunca escribe usuario
 * ni contraseña. Esa carpeta equivale a la sesión iniciada: no se comparte ni
 * se sube al repositorio.
 */
export function openSession(profileDir: string, headless: boolean, slowMo = 0): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir, {
    headless,
    acceptDownloads: true,
    // Para ver el robot trabajar: retrasa cada acción (BOT_SLOWMO_MS).
    slowMo,
    viewport: { width: 1280, height: 800 },
  });
}
