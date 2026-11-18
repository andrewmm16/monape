import { expect, test } from "@playwright/test";

/** La barra superior cabe en celulares angostos (antes, a 390 px, la campana y el menú se salían 33 px). */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

for (const width of [360, 390]) {
  test(`sin desborde horizontal a ${width} px`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "escritorio", "Fija su propio ancho; se ejecuta una vez.");
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/ingresar");
    await page.getByLabel("Correo corporativo").fill(rrhh.email!);
    await page.getByLabel("Contraseña").fill(rrhh.password!);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/panel/);
    for (const path of ["/panel", "/postulaciones", "/entrevistas"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Menú de usuario" })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `desborde en ${path}`).toBeLessThanOrEqual(0);
      const menu = await page.getByRole("button", { name: "Menú de usuario" }).boundingBox();
      expect(menu!.x + menu!.width, `menú fuera de pantalla en ${path}`).toBeLessThanOrEqual(width);
    }
  });
}
