import { expect, test } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * Verificación de requisitos por RRHH, contra un proyecto Supabase de PRUEBAS.
 * Crea sus propios datos ficticios: una vacante con dos requisitos y una
 * postulación cuyo CV menciona SQL pero no inglés.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

test("RRHH verifica un requisito sin evidencia, ve el origen, la puntuación sube y al quitarlo vuelve", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const suffix = Date.now().toString(36);
  const title = `Analista Verificación ${suffix}`;
  const candidate = `Persona Ficticia ${suffix}`;
  const note = "Conversación fluida de 10 minutos";

  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);

  // Vacante con dos requisitos y criterios aprobados.
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
    ["Inglés intermedio", "Inglés"],
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

  // Candidato con CV que menciona SQL pero no inglés, y evaluación con reglas.
  await page.goto("/candidatos/nuevo");
  await page.getByLabel("Nombre completo").fill(candidate);
  await page.getByLabel("Postula a").selectOption({ label: title });
  await page.getByRole("button", { name: "Registrar candidato" }).click();
  await expect(page.getByRole("heading", { name: candidate })).toBeVisible();
  const pdf = await makePdf([candidate, "Experiencia con SQL Server y reportes mensuales para las áreas usuarias de la empresa."]);
  await page.getByLabel(/Cargar CV/).setInputFiles({ name: "cv-ficticio.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
  await page.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(page.getByText("Texto extraído automáticamente")).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Evaluar con motor de reglas" }).click();
  await expect(page.getByText("Detalle por requisito")).toBeVisible();

  const detail = page.getByRole("heading", { name: "Detalle por requisito" }).locator("..");
  const english = detail.getByRole("listitem").filter({ hasText: "Inglés intermedio" });
  const sqlItem = detail.getByRole("listitem").filter({ hasText: "Consultas SQL" });
  // La barra de cumplimiento dice el % acreditado; se compara antes/después sin atarse al valor exacto del motor.
  const meter = page.getByRole("img", { name: /% acreditado en el CV/ });
  const score = async () => Number(/^(\d+) %/.exec((await meter.getAttribute("aria-label")) ?? "")?.[1] ?? Number.NaN);
  await expect(english).toContainText("No aparece en el CV");
  await expect(english).not.toContainText("Verificado ·");
  const before = await score();
  expect(before).toBeLessThan(100);

  // Verifica «Cumple» en entrevista.
  await english.getByRole("button", { name: "Verificar" }).click();
  const dialog = page.getByRole("dialog", { name: "Verificar requisito" });
  await expect(dialog.getByLabel("Fuente")).toHaveValue("entrevista");
  await dialog.getByLabel("Resultado").selectOption({ label: "Cumple" });
  // La nota es obligatoria.
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog.getByText("Escriba una nota de al menos 3 caracteres")).toBeVisible();
  await dialog.getByLabel("Nota").fill(note);
  await dialog.getByRole("button", { name: "Guardar" }).click();

  await expect(page.getByText("Verificación guardada y puntuación recalculada.")).toBeVisible();
  await expect(english).toContainText("Verificado · Entrevista");
  await expect(english).toContainText(/Verificado en entrevista el \d{2}\/\d{2}\/\d{4} por .+: «Conversación fluida de 10 minutos»/);
  await expect(english).toContainText("Cumple");
  await expect(english.getByRole("button", { name: "Cambiar" })).toBeVisible();
  await expect.poll(score).toBeGreaterThan(before);
  // El otro requisito sigue valorado según el CV, sin verificación.
  await expect(sqlItem).not.toContainText("Verificado ·");

  // El historial de la postulación registra el evento.
  await expect(page.getByText("Requisitos verificados por RRHH").first()).toBeVisible();

  // Quita la verificación: la nota es obligatoria y la puntuación vuelve.
  await english.getByRole("button", { name: "Quitar verificación" }).click();
  const removal = page.getByRole("dialog", { name: "Quitar verificación" });
  await removal.getByRole("button", { name: "Quitar verificación" }).click();
  await expect(removal.getByText("Escriba una nota de al menos 3 caracteres")).toBeVisible();
  await removal.getByLabel("Motivo").fill("Se registró por error");
  await removal.getByRole("button", { name: "Quitar verificación" }).click();
  await expect(page.getByText("Verificación quitada y puntuación recalculada.")).toBeVisible();
  await expect.poll(score).toBe(before);
  await expect(english).not.toContainText("Verificado · Entrevista");
  await expect(english).toContainText("No aparece en el CV");
});
