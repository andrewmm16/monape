import { expect, test, type Page } from "@playwright/test";

/**
 * Cierre de sesión por inactividad (src/lib/auth/inactivity.ts) contra el
 * proyecto Supabase de PRUEBAS. Usa las mismas variables que flujo-rrhh.spec.ts
 * y no crea datos.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

const IDLE_MESSAGE = "Su sesión se cerró por inactividad";

async function signIn(page: Page) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);
}

test("avisa a los 29 minutos sin actividad y cierra la sesión a los 30", async ({ page }) => {
  // Reloj simulado del navegador: el servidor sigue con la hora real.
  await page.clock.install();
  await signIn(page);

  const dialog = page.getByRole("alertdialog", { name: "¿Sigue ahí?" });
  await page.clock.fastForward("28:30");
  await expect(dialog).toBeHidden();
  await page.clock.fastForward("00:45");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/se cerrará por inactividad en \d+ segundos/);

  // Mover el mouse con el aviso abierto no basta: hay que responder.
  await page.mouse.move(10, 10);
  await page.mouse.move(200, 200);
  await page.clock.fastForward("00:05");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Seguir conectado" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/panel/);

  await page.clock.fastForward("29:15");
  await expect(dialog).toBeVisible();
  await page.clock.fastForward("01:00");
  await expect(page).toHaveURL(/\/ingresar\?motivo=inactividad&next=%2Fpanel/);
  await expect(page.getByText(IDLE_MESSAGE)).toBeVisible();

  // La sesión quedó cerrada en el servidor, no solo en la página.
  await page.goto("/panel");
  await expect(page).toHaveURL(/\/ingresar\?next=%2Fpanel/);
});

// La cookie vencida pero auténtica se cubre en tests/unit/inactivity.test.ts:
// aquí no se dispone de la clave secreta para firmarla.
test("el servidor cierra la sesión si la última actividad fue editada o no está registrada", async ({ page, context, baseURL }) => {
  await signIn(page);
  // Hora reciente escrita desde el navegador, sin la firma del servidor.
  await context.clearCookies({ name: "ultima-actividad" });
  await context.addCookies([
    { name: "ultima-actividad", value: String(Date.now()), url: baseURL!, httpOnly: true, sameSite: "Lax" },
  ]);
  await page.goto("/vacantes");
  await expect(page).toHaveURL(/\/ingresar\?motivo=inactividad&next=%2Fvacantes/);
  await expect(page.getByText(IDLE_MESSAGE)).toBeVisible();
  await page.goto("/vacantes");
  await expect(page).toHaveURL(/\/ingresar\?next=%2Fvacantes/);

  await signIn(page);
  await context.clearCookies({ name: "ultima-actividad" });
  const response = await page.request.get("/api/notificaciones");
  expect(response.status()).toBe(401);
  await page.goto("/panel");
  await expect(page).toHaveURL(/\/ingresar/);
});
