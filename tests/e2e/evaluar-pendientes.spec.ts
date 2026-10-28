import { expect, test } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * «Evaluar pendientes» en la pestaña Candidatos de una vacante, contra un
 * proyecto Supabase de PRUEBAS. Crea sus propios datos ficticios: una vacante
 * con postulaciones cargadas antes de aprobar los criterios (sin evaluar).
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

/** Solo letras: la sugerencia de nombre descarta líneas con cifras. */
function lettersOnly(): string {
  const raw = Date.now().toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

test("evalúa de una vez las postulaciones pendientes y ordena la lista por compatibilidad", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const tag = lettersOnly();
  const title = `Analista Pendientes ${tag}`;
  const names = {
    low: `Ana ${tag} Bajo`,
    high: `Beto ${tag} Alto`,
    mid: `Carla ${tag} Medio`,
  };

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

  // Postulaciones por carga masiva ANTES de aprobar criterios: quedan sin evaluar.
  await page.goto(`${vacancyUrl}/carga-masiva`);
  await page.getByLabel("Portal de origen de los CV").selectOption({ label: "Computrabajo" });
  await page.getByRole("button", { name: "Iniciar lote" }).click();
  await expect(page.getByText("Portal de origen:")).toBeVisible();
  const cv = (name: string, skills: string) => [
    name,
    "Analista de datos",
    `${name.split(" ")[0]!.toLowerCase()}.${tag.toLowerCase()}@correo.test`,
    skills,
    "Formación en ingeniería industrial y manejo de herramientas de análisis de información.",
  ];
  const files = {
    low: await makePdf(cv(names.low, "Experiencia en hojas de cálculo y reportes mensuales para las áreas usuarias.")),
    high: await makePdf(cv(names.high, "Experiencia con SQL Server y Power BI en proyectos de gestión de información.")),
    mid: await makePdf(cv(names.mid, "Experiencia con SQL Server y reportes mensuales para las áreas usuarias.")),
  };
  await page.locator('input[type="file"]').setInputFiles(
    (Object.keys(files) as (keyof typeof files)[]).map((key) => ({
      name: `${key}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(files[key]),
    })),
  );
  await expect(page.getByTestId("batch-item")).toHaveCount(3);
  await expect(page.getByLabel("Nombre de high.pdf")).toHaveValue(names.high);
  await page.getByRole("button", { name: "Registrar seleccionados (3)" }).click();
  await expect(page.getByText(/Registrados: 3 · Evaluados por reglas: 0/)).toBeVisible();

  // Criterios sin aprobar: solo aviso con enlace, sin botón.
  await page.goto(vacancyUrl);
  await expect(page.getByText(/Hay 3 postulaciones sin evaluar\. Apruebe los criterios para evaluarlas\./)).toBeVisible();
  await expect(page.getByRole("button", { name: /Evaluar pendientes/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Ir a los criterios" }).click();
  await expect(page).toHaveURL(/tab=criterios/);

  for (const [requirement, terms] of [
    ["Consultas SQL", "SQL, SQL Server"],
    ["Tableros Power BI", "Power BI"],
  ] as const) {
    await page.getByRole("button", { name: "Agregar requisito" }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo requisito" });
    await dialog.getByRole("textbox", { name: "Requisito", exact: true }).fill(requirement);
    await dialog.getByLabel("Términos de búsqueda").fill(terms);
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(requirement)).toBeVisible();
  }
  await page.getByRole("button", { name: "Aprobar criterios" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
  await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();

  // Evaluar pendientes
  await page.goto(`${vacancyUrl}?tab=candidatos&sort=nombre`);
  await page.getByRole("button", { name: "Evaluar pendientes (3)" }).click();
  const summary = page.getByTestId("evaluate-pending-summary");
  await expect(summary).toContainText("Se evaluaron 3 postulaciones; la lista está ordenada por compatibilidad.");
  await expect(page).toHaveURL(/tab=candidatos/);
  await expect(page).not.toHaveURL(/sort=nombre/);

  // El resumen sobrevive a un refresco y la lista queda de mayor a menor puntuación.
  await page.reload();
  await expect(summary).toContainText("Se evaluaron 3 postulaciones");
  const order = [names.high, names.mid, names.low];
  const rowTexts = await page.getByRole("row").filter({ hasText: tag }).allInnerTexts();
  expect(rowTexts).toHaveLength(3);
  order.forEach((name, index) => expect(rowTexts[index]).toContain(name));
  for (const text of rowTexts) expect(text).toMatch(/\d+ ?% acreditado/);

  // Ya no quedan pendientes: el botón no aparece.
  await expect(page.getByRole("button", { name: /Evaluar pendientes/ })).toHaveCount(0);
  await summary.getByRole("button", { name: "Cerrar resumen" }).click();
  await expect(summary).toHaveCount(0);
});
