import { expect, test } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * Carga masiva de CV contra un proyecto Supabase de PRUEBAS con las
 * migraciones aplicadas (incluida 20261027000100_intake.sql). Usa las mismas
 * variables que flujo-rrhh.spec.ts y crea sus propios datos ficticios.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

/** Solo letras: la sugerencia de nombre descarta líneas con cifras. */
function lettersOnly(): string {
  const raw = Date.now().toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

test("lote de 3 archivos (uno inválido): revisión, registro y bandeja con su portal", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const tag = lettersOnly();
  const title = `Analista Carga ${tag}`;
  const firstName = `Lucia ${tag} Ramos`;
  const secondName = `Mario ${tag} Torres`;

  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);

  // Vacante publicada con criterios aprobados (para que se evalúe al registrar).
  await page.goto("/vacantes/nueva");
  await page.getByLabel("Título del puesto").fill(title);
  await page.getByLabel("Área o departamento").fill("Pruebas");
  await page.getByLabel("Descripción", { exact: true }).fill(
    "Descripción ficticia de la vacante de pruebas: análisis de información y elaboración de reportes.",
  );
  await page.getByLabel("Ciudad", { exact: true }).fill("Lima");
  await page.getByLabel("Región", { exact: true }).fill("Lima");
  await page.getByLabel("Tipo de empleo").selectOption({ label: "Tiempo completo" });
  await page.getByRole("button", { name: "Crear vacante" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const vacancyUrl = page.url().split("?")[0]!;

  await page.goto(`${vacancyUrl}?tab=criterios`);
  await page.getByRole("button", { name: "Agregar requisito" }).click();
  const requirementDialog = page.getByRole("dialog", { name: "Nuevo requisito" });
  await requirementDialog.getByRole("textbox", { name: "Requisito", exact: true }).fill("Consultas SQL");
  await requirementDialog.getByLabel("Términos de búsqueda").fill("SQL, SQL Server");
  await requirementDialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Consultas SQL")).toBeVisible();
  await page.getByRole("button", { name: "Aprobar criterios" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
  await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Estado de la vacante actualizado.")).toBeVisible();
  await expect(page.getByText("Publicada", { exact: true })).toBeVisible();

  // Carga masiva desde la vacante
  await page.goto(vacancyUrl);
  await page.getByRole("link", { name: "Carga masiva de CV" }).click();
  await expect(page).toHaveURL(/\/carga-masiva$/);
  await page.getByLabel("Portal de origen de los CV").selectOption({ label: "Computrabajo" });
  await page.getByRole("button", { name: "Iniciar lote" }).click();
  await expect(page.getByText("Portal de origen:")).toBeVisible();

  const cvText = (name: string, mail: string) => [
    name,
    "Analista de datos",
    mail,
    "Experiencia con SQL Server, reportes y modelado de datos en proyectos de gestión.",
    "Formación en ingeniería industrial y manejo de herramientas de análisis.",
  ];
  const first = await makePdf(cvText(firstName, `lucia.${tag.toLowerCase()}@correo.test`));
  const second = await makePdf(cvText(secondName, `mario.${tag.toLowerCase()}@correo.test`));
  await page.locator('input[type="file"]').setInputFiles([
    { name: "lucia.pdf", mimeType: "application/pdf", buffer: Buffer.from(first) },
    { name: "invalido.pdf", mimeType: "application/pdf", buffer: Buffer.from("esto no es un pdf") },
    { name: "mario.pdf", mimeType: "application/pdf", buffer: Buffer.from(second) },
  ]);

  // Revisión: el inválido queda con error y no detiene al resto.
  const rows = page.getByTestId("batch-item");
  await expect(rows).toHaveCount(3);
  await expect(page.locator('[data-testid="batch-item"][data-status="error"]')).toContainText("El archivo no es un PDF válido");
  await expect(page.getByLabel("Nombre de lucia.pdf")).toHaveValue(firstName);
  await expect(page.getByLabel("Nombre de mario.pdf")).toHaveValue(secondName);
  await expect(page.getByLabel("Correo de lucia.pdf")).toHaveValue(`lucia.${tag.toLowerCase()}@correo.test`);

  // RRHH corrige varios datos seguidos con Tab sin perder lo que escribe
  // mientras se guarda el campo anterior.
  const correctedName = `${secondName} Diaz`;
  const correctedEmail = `mario.${tag.toLowerCase()}@otro.test`;
  // Teléfono distinto en cada corrida: uno repetido se marcaría como posible duplicado.
  const correctedPhone = `9${String(Date.now()).slice(-8)}`;
  await page.getByLabel("Nombre de mario.pdf").fill(correctedName);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Correo de mario.pdf")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(correctedEmail);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Teléfono de mario.pdf")).toBeFocused();
  await page.keyboard.type(correctedPhone);
  await page.getByLabel("Teléfono de mario.pdf").blur();
  await expect(async () => {
    await page.reload();
    await expect(page.getByLabel("Nombre de mario.pdf")).toHaveValue(correctedName, { timeout: 1_000 });
    await expect(page.getByLabel("Correo de mario.pdf")).toHaveValue(correctedEmail, { timeout: 1_000 });
    await expect(page.getByLabel("Teléfono de mario.pdf")).toHaveValue(correctedPhone, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page.getByRole("button", { name: "Registrar seleccionados (2)" }).click();
  await expect(page.getByText("Resumen del registro")).toBeVisible();
  await expect(page.getByText(/Registrados: 2 · Evaluados por reglas: 2/)).toBeVisible();

  // Las postulaciones aparecen en la vacante, con su portal...
  await page.goto(vacancyUrl);
  for (const name of [firstName, secondName]) {
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Computrabajo");
    await expect(row).toContainText("Carga masiva");
  }

  // ...y en la bandeja de entrada.
  await page.goto("/postulaciones");
  await expect(page.getByRole("heading", { name: "Postulaciones nuevas" })).toBeVisible();
  for (const name of [firstName, secondName]) {
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText(title);
    await expect(row).toContainText("Computrabajo");
    await expect(row).toContainText("Carga masiva");
  }

  // Una página inexistente de la bandeja muestra la última, sin error.
  await page.goto("/postulaciones?page=9999");
  await expect(page.getByRole("heading", { name: "Postulaciones nuevas" })).toBeVisible();

  // Cerrar el lote borra lo pendiente (el archivo con error).
  await page.goto(`${vacancyUrl}/carga-masiva`);
  await page.getByRole("button", { name: "Cerrar lote" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar lote" }).click();
  await expect(page.getByRole("button", { name: "Iniciar lote" })).toBeVisible();
});
