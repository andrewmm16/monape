import { expect, test } from "@playwright/test";
import { makeScannedPdf } from "../fixtures/documents";

/**
 * Lectura local (OCR) de un CV escaneado en la carga masiva, contra un proyecto
 * Supabase de PRUEBAS con las migraciones aplicadas (incluida 20261028000800).
 * El PDF se genera en la prueba (imagen sin texto, datos ficticios).
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

function lettersOnly(): string {
  const raw = Date.now().toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

test("carga masiva de un PDF escaneado: nombre propuesto por OCR, aviso y evaluación", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const tag = lettersOnly();
  const title = `Analista Escaneado ${tag}`;

  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);

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

  // Lote con un PDF que es solo una imagen (sin texto): se lee con OCR local.
  await page.goto(`${vacancyUrl}/carga-masiva`);
  await page.getByLabel("Portal de origen de los CV").selectOption({ label: "Computrabajo" });
  await page.getByRole("button", { name: "Iniciar lote" }).click();
  await expect(page.getByText("Portal de origen:")).toBeVisible();
  // Teléfono distinto en cada corrida: uno repetido se marcaría como posible duplicado.
  const digits = `9${String(Date.now()).slice(-8)}`;
  const phone = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  const scanned = await makeScannedPdf([
    "María Fernanda Quispe Ramos",
    "Analista de datos",
    `Teléfono: ${phone}`,
    "Experiencia con SQL Server, Power BI y reportes de gestión para las áreas usuarias.",
    "Formación en ingeniería industrial. Universidad ficticia, Lima.",
  ]);
  await page.locator('input[type="file"]').setInputFiles([
    { name: "escaneado.pdf", mimeType: "application/pdf", buffer: Buffer.from(scanned) },
  ]);

  const item = page.getByTestId("batch-item");
  await expect(item).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByLabel("Nombre de escaneado.pdf")).toHaveValue(/Quispe/);
  await expect(item).toContainText("Texto obtenido por reconocimiento automático de imagen (OCR local). Puede contener errores: revíselo antes de decidir.");
  await expect(page.getByLabel("Teléfono de escaneado.pdf")).toHaveValue(phone);

  // El OCR no reconoce la arroba: RRHH escribe el correo, como pide la revisión.
  await page.getByLabel("Correo de escaneado.pdf").fill(`quispe.${tag.toLowerCase()}@correo.test`);
  await page.getByLabel("Correo de escaneado.pdf").blur();

  await page.getByLabel("Registrar escaneado.pdf").check();

  // Se registra con los criterios aún sin aprobar: queda sin evaluar.
  await page.getByRole("button", { name: "Registrar seleccionados (1)" }).click();
  await expect(page.getByText(/Registrados: 1 · Evaluados por reglas: 0/)).toBeVisible();

  await page.goto(`${vacancyUrl}?tab=criterios`);
  await page.getByRole("button", { name: "Agregar requisito" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo requisito" });
  await dialog.getByRole("textbox", { name: "Requisito", exact: true }).fill("Consultas SQL");
  await dialog.getByLabel("Términos de búsqueda").fill("SQL, SQL Server");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Consultas SQL")).toBeVisible();
  await page.getByRole("button", { name: "Aprobar criterios" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
  await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();

  // El texto leído por OCR alcanza para evaluar la postulación.
  await page.goto(vacancyUrl);
  await page.getByRole("button", { name: "Evaluar pendientes (1)" }).click();
  await expect(page.getByTestId("evaluate-pending-summary")).toContainText("Se evaluó 1 postulación");
  await expect(page.getByTestId("evaluate-pending-summary")).not.toContainText("sin texto legible");
  const row = page.getByRole("row").filter({ hasText: "Quispe" });
  await expect(row).toContainText("acreditado");
});
