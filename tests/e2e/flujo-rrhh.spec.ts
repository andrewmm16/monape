import { expect, test } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * Flujo principal de RRHH contra un proyecto Supabase de PRUEBAS con las
 * migraciones aplicadas y los datos ficticios cargados (`npm run db:seed`).
 *
 * Variables: E2E_RRHH_EMAIL, E2E_RRHH_PASSWORD, E2E_ADMIN_EMAIL,
 * E2E_ADMIN_PASSWORD, además de las variables normales de la aplicación. Sin
 * ellas, estas pruebas se omiten (ver docs/informe-pruebas.md).
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");
test.describe.configure({ mode: "serial" });

// Postulación creada en el flujo de RRHH; la usa la prueba de «Pedir opinión».
let applicationUrl: string | undefined;
let candidateName: string | undefined;

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);
}

test("RRHH crea una vacante, aprueba criterios, registra un candidato, carga su CV y lo evalúa", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const suffix = Date.now().toString(36);
  await signIn(page, rrhh.email!, rrhh.password!);

  // Vacante
  await page.goto("/vacantes/nueva");
  await page.getByLabel("Título del puesto").fill(`Analista E2E ${suffix}`);
  await page.getByLabel("Área o departamento").fill("Pruebas");
  await page.getByLabel("Descripción", { exact: true }).fill(
    "Descripción ficticia de la vacante de pruebas: análisis de información y elaboración de reportes.",
  );
  await page.getByLabel("Ciudad", { exact: true }).fill("Lima");
  await page.getByLabel("Región", { exact: true }).fill("Lima");
  await page.getByLabel("Tipo de empleo").selectOption({ label: "Tiempo completo" });
  await page.getByRole("button", { name: "Crear vacante" }).click();
  await expect(page.getByRole("heading", { name: `Analista E2E ${suffix}` })).toBeVisible();
  const vacancyUrl = page.url().split("?")[0]!;

  // Requisito y aprobación de criterios
  await page.goto(`${vacancyUrl}?tab=criterios`);
  await page.getByRole("button", { name: "Agregar requisito" }).click();
  const requirementDialog = page.getByRole("dialog", { name: "Nuevo requisito" });
  await requirementDialog.getByRole("textbox", { name: "Requisito", exact: true }).fill("Consultas SQL");
  // Sugerencias de términos relacionados: al pulsar una, se agrega al campo y queda guardada.
  const keywordsField = requirementDialog.getByLabel("Términos de búsqueda");
  await keywordsField.fill("SQL");
  await expect(requirementDialog.getByText("Términos relacionados sugeridos")).toBeVisible();
  await requirementDialog.getByRole("button", { name: "Agregar todos" }).click();
  await expect(keywordsField).toHaveValue(/^SQL, SQL Server, MySQL, .*consultas SQL$/);
  await keywordsField.fill("SQL");
  await requirementDialog.getByRole("button", { name: "SQL Server", exact: true }).click();
  await expect(keywordsField).toHaveValue("SQL, SQL Server");
  await expect(requirementDialog.getByRole("button", { name: "SQL Server", exact: true })).toHaveCount(0);
  await requirementDialog.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Consultas SQL")).toBeVisible();
  await expect(page.getByText("Términos: SQL, SQL Server")).toBeVisible();
  await page.getByRole("button", { name: "Aprobar criterios" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Aprobar criterios" }).click();
  await expect(page.getByText(/Versión 1 aprobada/)).toBeVisible();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Estado de la vacante actualizado.")).toBeVisible();
  await expect(page.getByText("Publicada", { exact: true })).toBeVisible();

  // Candidato
  await page.goto("/candidatos/nuevo");
  await page.getByLabel("Nombre completo").fill(`Persona Ficticia ${suffix}`);
  await page.getByLabel("Postula a").selectOption({ label: `Analista E2E ${suffix}` });
  await page.getByRole("button", { name: "Registrar candidato" }).click();
  await expect(page.getByRole("heading", { name: `Persona Ficticia ${suffix}` })).toBeVisible();
  // Con una postulación en proceso no se ofrece asociarlo a otra vacante.
  await expect(page.getByText(`Está en proceso en «Analista E2E ${suffix}»`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar postulación" })).toHaveCount(0);

  // CV
  const pdf = await makePdf([`Persona Ficticia ${suffix}`, "Experiencia con SQL Server y reportes."]);
  await page.getByLabel(/Cargar CV/).setInputFiles({ name: "cv-ficticio.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
  await page.getByRole("button", { name: "Cargar", exact: true }).click();
  await expect(page.getByText("cv-ficticio.pdf")).toBeVisible();
  await expect(page.getByText("Texto extraído automáticamente")).toBeVisible();

  // Evaluación: muestra criterios, evidencias y limitaciones; el estado no cambia
  await page.getByRole("link", { name: `Analista E2E ${suffix}` }).click();
  await page.getByRole("button", { name: "Evaluar con motor de reglas" }).click();
  await expect(page.getByText("Detalle por requisito")).toBeVisible();
  await expect(page.getByText("Evidencia en el CV:")).toBeVisible();
  await expect(page.getByText("Limitaciones de esta evaluación")).toBeVisible();
  await expect(page.getByText("Nuevo").first()).toBeVisible();
  applicationUrl = page.url().split("?")[0]!;
  candidateName = `Persona Ficticia ${suffix}`;

  // Estado sugerido por la evaluación, con su motivo; nada se guarda solo.
  await expect(page.getByLabel("Nuevo estado")).toHaveValue("preseleccionado");
  await expect(page.getByLabel(/^Motivo/)).toHaveValue(/^Se preselecciona porque el CV acredita 1 de 1 requisitos obligatorios/);
  await expect(page.getByLabel("Observación interna (opcional)")).toHaveValue(/Siguiente paso: programar la entrevista/);
  // Las sugerencias no se insertan dos veces.
  await expect(page.getByRole("button", { name: "Sugerencia insertada" })).toBeDisabled();
  await page.getByRole("button", { name: "Sugerir a partir de la evaluación" }).click();
  await expect(page.getByRole("button", { name: "Sugerencia insertada" })).toHaveCount(2);
  const observation = await page.getByLabel("Nueva observación").inputValue();
  expect(observation.match(/Resumen de la evaluación/g)).toHaveLength(1);

  // Listado completo en la vacante
  await page.goto(`${vacancyUrl}?tab=candidatos`);
  await expect(page.getByRole("link", { name: `Persona Ficticia ${suffix}` })).toBeVisible();

  // Un posible duplicado se avisa en una ventana emergente.
  await page.goto("/candidatos/nuevo");
  await page.getByLabel("Nombre completo").fill(`Persona Ficticia ${suffix}`);
  await page.getByRole("button", { name: "Registrar candidato" }).click();
  const duplicateDialog = page.getByRole("alertdialog", { name: "Posibles candidatos duplicados" });
  await expect(duplicateDialog.getByRole("link", { name: `Persona Ficticia ${suffix}` })).toBeVisible();
  await duplicateDialog.getByRole("button", { name: "Revisar datos" }).click();
  await expect(duplicateDialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/candidatos\/nuevo/);
});

test("RRHH pide una opinión y solo la persona consultada recibe la notificación", async ({ page, browser }, testInfo) => {
  test.skip(!admin.email || !admin.password || testInfo.project.name !== "escritorio", "Requiere usuario administrador.");
  test.skip(!applicationUrl || !candidateName, "Requiere la postulación creada en el flujo de RRHH.");
  const aboutCandidate = new RegExp(candidateName!);

  await signIn(page, rrhh.email!, rrhh.password!);
  await page.goto(applicationUrl!);
  await page.getByLabel("Pedir opinión a").selectOption({ label: process.env.E2E_ADMIN_NAME ?? "Administración Ficticia" });
  await page.getByRole("button", { name: "Pedir opinión" }).click();
  await expect(page.getByText("Solicitud de opinión enviada.")).toBeVisible();
  await expect(page.getByText("Pendiente", { exact: true })).toBeVisible();

  // La persona consultada ve el aviso amarillo, la campana y la postulación.
  const adminPage = await (await browser.newContext({ locale: "es-PE" })).newPage();
  await signIn(adminPage, admin.email!, admin.password!);
  await expect(adminPage.getByText(aboutCandidate).first()).toBeVisible();
  await adminPage.getByRole("button", { name: /Notificaciones: \d+ sin leer/ }).click();
  await adminPage.getByRole("menuitem", { name: aboutCandidate }).first().click();
  await expect(adminPage).toHaveURL(applicationUrl!);
  await expect(adminPage.getByText("Le pidieron su opinión.")).toBeVisible();

  // Quien la pidió no recibe esa notificación.
  await page.reload();
  await page.getByRole("button", { name: /^Notificaciones/ }).click();
  await expect(page.getByRole("menuitem", { name: /le pidió su opinión/ }).filter({ hasText: candidateName! })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Responde con una observación: queda respondida y RRHH recibe su notificación.
  await adminPage.getByLabel("Nueva observación").fill("Opinión E2E: perfil adecuado.");
  await adminPage.getByRole("button", { name: "Registrar observación" }).click();
  await expect(adminPage.getByText("Respondida", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Respondida", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Notificaciones: \d+ sin leer/ }).click();
  await expect(page.getByRole("menuitem", { name: /respondió su solicitud de opinión/ }).filter({ hasText: candidateName! })).toHaveCount(1);
});

test("RRHH no ve la gestión de usuarios", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "escritorio", "Se ejecuta una vez.");
  await signIn(page, rrhh.email!, rrhh.password!);
  await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);
  await page.goto("/usuarios");
  await expect(page.getByText("Acceso restringido")).toBeVisible();
});

test("un administrador desactiva, reactiva y elimina un usuario desde la papelera", async ({ page }, testInfo) => {
  test.skip(!admin.email || !admin.password || testInfo.project.name !== "escritorio", "Requiere usuario administrador.");
  const suffix = Date.now().toString(36);
  const name = `Usuario Papelera ${suffix}`;
  await signIn(page, admin.email!, admin.password!);

  await page.goto("/usuarios");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Correo corporativo").fill(`papelera.${suffix}@reclutamiento.test`);
  await page.getByRole("button", { name: "Invitar" }).click();
  const activeRow = page.getByRole("row", { name: new RegExp(name) });
  await expect(activeRow).toBeVisible();

  const deactivate = async () => {
    await activeRow.getByRole("button", { name: "Desactivar" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Desactivar" }).click();
    await expect(activeRow).toHaveCount(0);
  };
  await deactivate();

  await page.getByRole("link", { name: /Papelera/ }).click();
  const trashedRow = page.getByRole("row", { name: new RegExp(name) });
  await trashedRow.getByRole("button", { name: "Reactivar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reactivar" }).click();
  await expect(trashedRow).toHaveCount(0);

  await page.goto("/usuarios");
  await deactivate();
  await page.goto("/usuarios/papelera");
  await trashedRow.getByRole("button", { name: "Eliminar definitivamente" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Eliminar" }).click();
  await expect(page.getByText("Usuario eliminado definitivamente.")).toBeVisible();
  await expect(trashedRow).toHaveCount(0);
  await page.goto("/usuarios");
  await expect(activeRow).toHaveCount(0);
});
