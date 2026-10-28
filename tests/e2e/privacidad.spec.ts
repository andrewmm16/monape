import { expect, test, type Page } from "@playwright/test";

/**
 * Aviso de privacidad versionado (2.1) contra un proyecto Supabase de PRUEBAS.
 *
 * ATENCIÓN: la prueba deja un aviso VIGENTE en la base local (con título
 * «PRUEBA — sin aprobación legal»). Es esperado; no usar contra datos reales.
 * La parte pública se enciende desde playwright.config.ts con backend real.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

test.skip(
  !rrhh.email || !rrhh.password || !admin.email || !admin.password,
  "Requiere un proyecto Supabase de pruebas (E2E_RRHH_* y E2E_ADMIN_*).",
);
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);
}

test("administración crea un borrador, lo activa con una referencia y la página pública lo muestra", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "escritorio", "Se ejecuta en escritorio.");
  const suffix = Date.now().toString(36);
  const title = `PRUEBA — sin aprobación legal ${suffix}`;
  await signIn(page, admin.email!, admin.password!);

  await page.getByRole("link", { name: "Configuración" }).first().click();
  await expect(page).toHaveURL(/\/configuracion\/privacidad/);
  await expect(page.getByRole("heading", { name: "Aviso de privacidad", level: 1 })).toBeVisible();

  // Nuevo borrador: precargado con el texto sugerido (con sus marcadores pendientes).
  await page.getByRole("button", { name: "Nuevo borrador" }).click();
  const editor = page.getByRole("dialog", { name: "Nuevo borrador" });
  await expect(editor.getByLabel("Texto del aviso")).toHaveValue(/\[RAZÓN SOCIAL\]/);
  await editor.getByLabel("Título").fill(title);
  await editor
    .getByLabel("Texto del aviso")
    .fill(`Texto de prueba, sin validez legal.\n\n<strong>no se interpreta</strong> [MARCADOR PENDIENTE] ${suffix}`);
  // La vista previa también es texto plano.
  await expect(editor.getByText("<strong>no se interpreta</strong>", { exact: false })).toBeVisible();
  expect(await editor.locator("strong").count()).toBe(0);
  await editor.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador creado.")).toBeVisible();

  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row.getByText("Borrador", { exact: true })).toBeVisible();

  // Activar: exige referencia y la casilla de confirmación.
  await row.getByRole("button", { name: "Activar" }).click();
  const dialog = page.getByRole("dialog", { name: /Activar la versión/ });
  await dialog.getByRole("button", { name: "Activar versión" }).click();
  await expect(dialog.getByText("Indique la referencia de aprobación")).toBeVisible();
  await dialog.getByLabel("Referencia de aprobación").fill("Referencia ficticia E2E");
  await dialog.getByRole("button", { name: "Activar versión" }).click();
  await expect(dialog.getByText("Confirme que el área legal aprobó este texto", { exact: true }).first()).toBeVisible();
  await dialog.getByLabel("Confirmo que el área legal aprobó este texto").click();
  await dialog.getByRole("button", { name: "Activar versión" }).click();
  await expect(page.getByText("Aviso activado. Es la versión vigente.")).toBeVisible();

  const activeRow = page.getByRole("row", { name: new RegExp(title) });
  await expect(activeRow.getByText("Vigente", { exact: true })).toBeVisible();
  await expect(activeRow.getByText("Referencia ficticia E2E")).toBeVisible();
  // Vigente: solo lectura.
  await expect(activeRow.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(activeRow.getByRole("button", { name: "Eliminar" })).toHaveCount(0);

  // Página pública, sin sesión ni cookies.
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const response = await publicPage.goto("/empleos/privacidad");
  expect(response?.status()).toBe(200);
  await expect(publicPage.getByRole("heading", { name: title })).toBeVisible();
  await expect(publicPage.getByText("[MARCADOR PENDIENTE]", { exact: false })).toBeVisible();
  await expect(publicPage.getByText("<strong>no se interpreta</strong>", { exact: false })).toBeVisible();
  expect(await publicPage.locator("main strong").count()).toBe(0);
  await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(response?.headers()["set-cookie"]).toBeUndefined();
  expect(await publicContext.cookies()).toEqual([]);
  await publicContext.close();
});

test("RRHH no ve «Configuración» y no accede a la configuración de privacidad", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "escritorio", "Se ejecuta en escritorio.");
  await signIn(page, rrhh.email!, rrhh.password!);
  await expect(page.getByRole("link", { name: "Configuración" })).toHaveCount(0);
  const response = await page.goto("/configuracion/privacidad");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Aviso de privacidad", level: 1 })).toHaveCount(0);
});
