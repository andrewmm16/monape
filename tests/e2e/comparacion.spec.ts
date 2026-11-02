import { expect, test } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * Comparación de candidatos y «mejor opción», contra un proyecto Supabase de
 * PRUEBAS. Crea una vacante con dos requisitos obligatorios y tres candidatos
 * ficticios con CV distintos (los tres se evalúan al registrarse).
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

/** Solo letras: la sugerencia de nombre descarta líneas con cifras. */
function lettersOnly(): string {
  const raw = Date.now().toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

test("RRHH compara candidatos: los mejores, la selección manual y un «no cumple» verificado que manda al final", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const tag = lettersOnly();
  const title = `Analista Comparación ${tag}`;
  const names = { high: `Beto ${tag} Alto`, mid: `Carla ${tag} Medio`, low: `Ana ${tag} Bajo` };

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

  await page.goto(`${vacancyUrl}?tab=criterios`);
  for (const [requirement, terms] of [
    ["Consultas SQL", "SQL, SQL Server"],
    ["Tableros Power BI", "Power BI"],
  ] as const) {
    await page.getByRole("button", { name: "Agregar requisito" }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo requisito" });
    await dialog.getByRole("textbox", { name: "Requisito", exact: true }).fill(requirement);
    await dialog.getByLabel("Términos de búsqueda").fill(terms);
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(requirement, { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Aprobar criterios" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
  await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();

  // Carga masiva con criterios aprobados: los tres se evalúan al registrarse.
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
  await expect(page.getByText(/Registrados: 3 · Evaluados por reglas: 3/)).toBeVisible();

  const columnNames = async () => {
    const texts = await page.getByTestId("compare-column").allInnerTexts();
    return texts.map((text) => [names.high, names.mid, names.low].find((name) => text.includes(name)));
  };

  // «Comparar los mejores»: los tres, de mayor a menor.
  await page.goto(`${vacancyUrl}?tab=candidatos`);
  await page.getByRole("link", { name: "Comparar los mejores" }).click();
  await expect(page).toHaveURL(/comparar\?mejores=1/);
  await expect(page.getByText(/Mejor opción: van al final quienes/)).toBeVisible();
  await expect(page.getByTestId("compare-column")).toHaveCount(3);
  expect(await columnNames()).toEqual([names.high, names.mid, names.low]);
  const firstColumn = page.getByTestId("compare-column").first();
  await expect(firstColumn).toContainText("1.º");
  await expect(firstColumn).toContainText("100 % acreditado");
  const table = page.getByTestId("comparison-scroll");
  await expect(table.getByRole("row").filter({ hasText: "Consultas SQL" })).toContainText("Cumple");
  await expect(table.getByRole("row").filter({ hasText: "Tableros Power BI" })).toContainText("Sin evidencia");
  await expect(table.getByRole("row").filter({ hasText: "Obligatorios acreditados" })).toContainText("2 de 2");
  await expect(table.getByRole("row").filter({ hasText: "Requisitos verificados" })).toContainText("0 de 2");

  // Verifica «No cumple» (obligatorio) en el primero.
  await firstColumn.getByRole("link", { name: names.high, exact: true }).click();
  await expect(page.getByText("Detalle por requisito")).toBeVisible();
  const sql = page.getByRole("listitem").filter({ hasText: "Consultas SQL" }).filter({ hasText: "Peso" });
  await sql.getByRole("button", { name: "Verificar" }).click();
  const dialog = page.getByRole("dialog", { name: "Verificar requisito" });
  await dialog.getByLabel("Resultado").selectOption({ label: "No cumple" });
  await dialog.getByLabel("Nota").fill("No resolvió la consulta de la prueba");
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(sql).toContainText("Verificado · Entrevista");

  // Al volver a comparar, ese candidato queda al final.
  await page.goto(`${vacancyUrl}/comparar?mejores=1`);
  await expect(page.getByTestId("compare-column")).toHaveCount(3);
  expect(await columnNames()).toEqual([names.mid, names.low, names.high]);
  const lastColumn = page.getByTestId("compare-column").last();
  await expect(lastColumn).toContainText("3.º");
  await expect(table.getByRole("row").filter({ hasText: "Consultas SQL" })).toContainText("Verificado · Entrevista");

  // Selección manual de 2: el botón solo se habilita con 2 a 4.
  await page.goto(`${vacancyUrl}?tab=candidatos`);
  const compareSelected = page.getByRole("button", { name: /^Comparar seleccionados/ });
  await expect(compareSelected).toBeDisabled();
  await page.getByLabel(`Comparar a ${names.high}`).check();
  await expect(compareSelected).toBeDisabled();
  await page.getByLabel(`Comparar a ${names.low}`).check();
  await expect(compareSelected).toBeEnabled();
  await expect(compareSelected).toHaveText("Comparar seleccionados (2)");
  await compareSelected.click();
  await expect(page).toHaveURL(/comparar\?ids=/);
  await expect(page.getByTestId("compare-column")).toHaveCount(2);
  // Por defecto, «mejor opción»: el candidato con el «no cumple» verificado va después.
  expect(await columnNames()).toEqual([names.low, names.high]);
  await page.getByRole("link", { name: "En el orden elegido" }).click();
  await expect(page).toHaveURL(/orden=elegido/);
  expect(await columnNames()).toEqual([names.high, names.low]);
  // El puesto sigue siendo el de «mejor opción».
  await expect(page.getByTestId("compare-column").first()).toContainText("2.º");

  // Con 2 columnas no se puede quitar a nadie; con identificadores inválidos hay un mensaje claro.
  await expect(page.getByRole("link", { name: /^Quitar a / })).toHaveCount(0);
  await page.goto(`${vacancyUrl}/comparar?ids=no-es-un-uuid,otro`);
  await expect(page.getByText("No se puede mostrar la comparación")).toBeVisible();
  await expect(page.getByText(/identificador incorrecto/)).toBeVisible();

  // Quitar a uno desde la comparación de los mejores (3 → 2) y desplazamiento propio de la tabla en celular.
  await page.goto(`${vacancyUrl}/comparar?mejores=1`);
  await page.getByRole("link", { name: `Quitar a ${names.high} de la comparación` }).click();
  await expect(page).toHaveURL(/comparar\?ids=/);
  expect(await columnNames()).toEqual([names.mid, names.low]);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  // El contenido de la página no se desborda: la tabla se desplaza dentro de su contenedor.
  const overflow = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    return main.scrollWidth - main.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  const scroller = page.getByTestId("comparison-scroll");
  expect(await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
});
