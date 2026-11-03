import { expect, test } from "@playwright/test";

/** Tema día/noche sobre /ingresar (no requiere Supabase). */
test("sin preferencia guardada sigue al sistema, sin errores de CSP", async ({ page }) => {
  const consola: string[] = [];
  page.on("console", (message) => consola.push(message.text()));

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/ingresar");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

  expect(consola.filter((text) => /content security policy/i.test(text))).toEqual([]);
});

test("un valor inválido guardado en el navegador no rompe la página", async ({ page }) => {
  // next-themes aplica ese valor como clase inerte; la página sigue funcionando (modo día).
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(error.message));
  await page.addInitScript(() => localStorage.setItem("theme", "basura"));
  await page.goto("/ingresar");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errores).toEqual([]);
});
