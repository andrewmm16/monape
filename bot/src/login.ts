import { getAdapter, parseAdapterNames } from "./adapters";
import { openSession } from "./browser";
import { loadConfig } from "./config";

/**
 * Abre el navegador del robot en la página de ingreso del portal para que UNA
 * PERSONA inicie sesión a mano (usuario, contraseña, CAPTCHA, código). La sesión
 * queda guardada en el perfil. Al terminar, cerrar la ventana. Con varios
 * portales (`BOT_ADAPTER=demo`) abre una pestaña por portal.
 * Uso: `npm run bot:login`.
 */
async function main() {
  const config = loadConfig();
  const context = await openSession(config.profileDir, false);
  for (const [index, name] of parseAdapterNames(config.adapter).entries()) {
    const page = index === 0 ? (context.pages()[0] ?? (await context.newPage())) : await context.newPage();
    await page.goto(getAdapter(name).loginUrl(config));
  }
  console.log("Inicie sesión en la ventana abierta y ciérrela al terminar.");
  await new Promise<void>((resolve) => context.on("close", () => resolve()));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
