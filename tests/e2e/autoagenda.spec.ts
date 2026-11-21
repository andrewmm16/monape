import { expect, test } from "@playwright/test";

/**
 * Autoagenda (docs/superpowers/specs/2026-11-20-talento-y-autoagenda-design.md),
 * contra un proyecto Supabase de PRUEBAS: RRHH invita a una persona sin correo a
 * elegir entre dos horarios, copia el enlace, la persona elige uno en la página
 * pública (sin sesión) y la entrevista queda programada.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

test("RRHH invita a agendar, la persona elige su horario y la entrevista queda programada", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const suffix = Date.now().toString(36);
  const title = `Analista Agenda ${suffix}`;

  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);

  // Vacante publicada con un requisito aprobado.
  await page.goto("/vacantes/nueva");
  await page.getByLabel("Título del puesto").fill(title);
  await page.getByLabel("Área o departamento").fill("Pruebas");
  await page.getByLabel("Descripción", { exact: true }).fill("Descripción ficticia de la vacante de pruebas para la autoagenda de entrevistas.");
  await page.getByLabel("Ciudad", { exact: true }).fill("Lima");
  await page.getByLabel("Región", { exact: true }).fill("Lima");
  await page.getByLabel("Tipo de empleo").selectOption({ label: "Tiempo completo" });
  await page.getByRole("button", { name: "Crear vacante" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const vacancyUrl = page.url().split("?")[0]!;
  await page.goto(`${vacancyUrl}?tab=criterios`);
  await page.getByRole("button", { name: "Agregar requisito" }).click();
  const requirementDialog = page.getByRole("dialog", { name: "Nuevo requisito" });
  await requirementDialog.getByRole("textbox", { name: "Requisito", exact: true }).fill("Atención al cliente");
  await requirementDialog.getByLabel("Términos de búsqueda").fill("atención al cliente");
  await requirementDialog.getByRole("button", { name: "Guardar" }).click();
  await page.getByRole("button", { name: "Aprobar criterios" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
  await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();
  await page.goto(`${vacancyUrl}?tab=portales`);
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Publicada", { exact: true }).first()).toBeVisible();

  // Candidato sin correo (no se envía nada; RRHH copia el enlace).
  await page.goto("/candidatos/nuevo");
  await page.getByLabel("Nombre completo").fill(`Persona Agenda ${suffix}`);
  await page.getByLabel("Postula a").selectOption({ label: title });
  await page.getByRole("button", { name: "Registrar candidato" }).click();
  await expect(page.getByRole("heading", { name: `Persona Agenda ${suffix}` })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await expect(page).toHaveURL(/\/postulaciones\//);
  const applicationUrl = page.url().split(/[?#]/)[0]!;

  // Invitar a agendar: dos horarios (los de por defecto, mañana 10:00 y 15:00) y enlace virtual.
  await page.getByRole("button", { name: "Invitar a agendar" }).click();
  const dialog = page.getByRole("dialog", { name: "Invitar a agendar" });
  await dialog.getByLabel("Enlace de la reunión").fill("https://meet.ejemplo.test/agenda");
  await dialog.getByRole("button", { name: "Enviar invitación" }).click();
  const link = dialog.getByLabel("Enlace para elegir horario");
  await expect(link).toBeVisible();
  await expect(dialog.getByText(/No se envió el correo/)).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/\/agendar\/[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByTestId("booking-status")).toContainText("Invitación a agendar pendiente: 2 horarios");

  // La persona abre su enlace sin sesión y elige el primer horario.
  const visitor = await browser.newContext();
  const publicPage = await visitor.newPage();
  await publicPage.goto(new URL(url).pathname);
  await expect(publicPage.getByRole("heading", { name: title })).toBeVisible();
  await publicPage.getByRole("radio").first().check();
  await publicPage.getByRole("button", { name: "Confirmar horario" }).click();
  await expect(publicPage.getByTestId("booking-confirmed")).toContainText("agendada");
  await visitor.close();

  // En la postulación: la entrevista programada y sin invitación pendiente.
  await page.goto(applicationUrl);
  await expect(page.getByTestId("booking-status")).toHaveCount(0);
  await expect(page.locator("#entrevistas").getByText(/Programada/i).first()).toBeVisible();
});
