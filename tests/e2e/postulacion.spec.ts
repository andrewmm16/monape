import { randomInt } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { makePdf } from "../fixtures/documents";

/**
 * Formulario público de postulación (2.2) contra un proyecto Supabase de PRUEBAS.
 *
 * ATENCIÓN: la prueba activa un aviso de privacidad de prueba («PRUEBA — sin
 * aprobación legal») que queda VIGENTE en la base local, y crea vacantes y
 * postulaciones ficticias. No usar contra datos reales. Es independiente de
 * otras pruebas: prepara su propio aviso y su propia vacante.
 *
 * El servidor lo arranca playwright.config.ts con PUBLIC_APPLY_ENABLED=true y
 * un INTAKE_HASH_SECRET ficticio. Las comprobaciones de la prueba de trabajo, el
 * uso único del desafío y el límite por IP siguen activas: cada contexto público
 * usa una IP de documentación distinta (x-forwarded-for) para no agotar el
 * límite de 5 envíos por hora.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };

test.skip(
  !rrhh.email || !rrhh.password || !admin.email || !admin.password,
  "Requiere un proyecto Supabase de pruebas (E2E_RRHH_* y E2E_ADMIN_*).",
);
test.describe.configure({ mode: "serial" });

const DESCRIPTION =
  "Descripción ficticia de la vacante de pruebas: análisis de información y elaboración de reportes para las áreas usuarias.";

/** Solo letras: así el nombre no se confunde con cifras. */
function lettersOnly(): string {
  const raw = (Date.now() + randomInt(1000)).toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);
}

/** Administración crea un borrador y lo activa: queda como el aviso vigente. */
async function activateTestNotice(page: Page, suffix: string) {
  await signIn(page, admin.email!, admin.password!);
  await page.goto("/configuracion/privacidad");
  const title = `PRUEBA — sin aprobación legal ${suffix}`;
  await page.getByRole("button", { name: "Nuevo borrador" }).click();
  const editor = page.getByRole("dialog", { name: "Nuevo borrador" });
  await editor.getByLabel("Título").fill(title);
  await editor.getByLabel("Texto del aviso").fill(`Texto de prueba, sin validez legal. ${suffix}`);
  await editor.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText("Borrador creado.")).toBeVisible();
  await page.getByRole("row", { name: new RegExp(title) }).getByRole("button", { name: "Activar" }).click();
  const dialog = page.getByRole("dialog", { name: /Activar la versión/ });
  await dialog.getByLabel("Referencia de aprobación").fill("Referencia ficticia E2E");
  await dialog.getByLabel("Confirmo que el área legal aprobó este texto").click();
  await dialog.getByRole("button", { name: "Activar versión" }).click();
  await expect(page.getByText("Aviso activado. Es la versión vigente.")).toBeVisible();
}

/** RRHH crea una vacante con un requisito, aprueba los criterios y la publica. Devuelve la ficha y la URL pública. */
async function createPublishedVacancy(page: Page, title: string): Promise<{ vacancyUrl: string; publicPath: string; code: string }> {
  await signIn(page, rrhh.email!, rrhh.password!);
  await page.goto("/vacantes/nueva");
  await page.getByLabel("Título del puesto").fill(title);
  await page.getByLabel("Área o departamento").fill("Pruebas");
  await page.getByLabel("Descripción", { exact: true }).fill(DESCRIPTION);
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

  await page.goto(vacancyUrl);
  const publicLink = page.getByRole("link", { name: /\/empleos\/analista-postulacion-/ });
  await expect(publicLink).toBeVisible();
  const publicPath = new URL((await publicLink.getAttribute("href"))!, "http://localhost").pathname;
  return { vacancyUrl, publicPath, code: publicPath.slice(-10) };
}

/**
 * Contexto de escritorio para la preparación (administración y RRHH). El corredor
 * aplica a `browser.newContext()` las opciones del proyecto: en el proyecto móvil
 * hay que restablecer la pantalla de escritorio.
 */
function desktopContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
}

let ipCounter = randomInt(1, 200);
/** Contexto SIN sesión, con una IP de documentación propia (RFC 5737). */
async function publicContext(browser: Browser): Promise<BrowserContext> {
  ipCounter = (ipCounter % 250) + 1;
  return browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${ipCounter}, 10.0.0.1` },
  });
}

async function fillForm(
  page: Page,
  values: { name: string; email: string; phone: string; file: { name: string; mimeType: string; buffer: Buffer }; talentPool?: boolean },
) {
  await page.getByLabel("Nombre completo").fill(values.name);
  await page.getByLabel("Correo electrónico").fill(values.email);
  await page.getByLabel("Teléfono").fill(values.phone);
  await page.getByLabel("Ciudad (opcional)").fill("Lima");
  await page.getByLabel(/^CV \(PDF o Word, hasta 4 MB\)/).setInputFiles(values.file);
  await page.getByLabel("He leído y acepto el aviso de privacidad").click();
  if (values.talentPool) await page.getByLabel("Acepto que conserven mi CV para futuras vacantes (opcional)").click();
}

const SUCCESS = /Recibimos su postulación\. Número de referencia: ([A-HJ-NP-Z2-9]{8})\. Si su perfil avanza en el proceso, el equipo de selección se comunicará con usted/;

/** Envía el formulario y comprueba que la respuesta de la acción no trae cookies. */
async function submitAndWait(page: Page) {
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname.startsWith("/empleos/"),
  );
  await page.getByRole("button", { name: "Enviar postulación" }).click();
  const response = await responsePromise;
  const headers = await response.headersArray();
  expect(headers.filter((header) => header.name.toLowerCase() === "set-cookie")).toEqual([]);
  return response;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("postulación pública: envío sin sesión, bandeja, repetición con el mismo correo, archivo inválido y convocatoria cerrada", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez en escritorio.");
  const tag = lettersOnly();
  const title = `Analista Postulacion ${tag}`;
  const applicantName = `Rosa ${tag} Quispe`;
  const secondName = `Marta ${tag} Soto`;
  const email = `rosa.${tag.toLowerCase()}@correo.test`;
  const phone = `9${String(Date.now()).slice(-8)}`;
  const pdfLines = (name: string) => [name, "Analista de datos", "Experiencia con SQL Server, reportes y modelado de datos en proyectos de gestión."];
  const pdf = Buffer.from(await makePdf(pdfLines(applicantName)));

  // Preparación: aviso vigente de prueba (administración) y vacante publicada (RRHH).
  const adminContext = await desktopContext(browser);
  await activateTestNotice(await adminContext.newPage(), tag.toLowerCase());
  await adminContext.close();
  const { vacancyUrl, publicPath, code } = await createPublishedVacancy(page, title);

  // Sin sesión: el formulario se completa y se envía.
  const visitor = await publicContext(browser);
  const publicPage = await visitor.newPage();
  const violations: string[] = [];
  publicPage.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load)/i.test(message.text())) violations.push(message.text());
  });
  const challenge = await visitor.request.get(`/empleos/desafio/${code}`);
  expect(challenge.status()).toBe(200);
  expect(challenge.headers()["cache-control"]).toBe("no-store");
  expect(challenge.headers()["set-cookie"]).toBeUndefined();
  expect((await visitor.request.get("/empleos/desafio/no-es-un-codigo")).status()).toBe(404);

  const pageResponse = await publicPage.goto(publicPath);
  expect(pageResponse?.status()).toBe(200);
  await expect(publicPage.getByRole("heading", { name: "Postular a esta vacante" })).toBeVisible();
  // El botón de la cabecera lleva a la sección del formulario.
  await expect(publicPage.getByRole("link", { name: "Postular", exact: true })).toHaveAttribute("href", "#postular");
  await expect(publicPage.getByText("No incluya en su CV DNI, fotografía, fecha de nacimiento, estado civil ni datos de salud")).toBeVisible();
  await expect(publicPage.getByText(/Sus datos serán tratados por Empresa Ficticia E2E para este proceso de selección/)).toBeVisible();
  const privacyLink = publicPage.getByRole("link", { name: "Leer el aviso de privacidad completo" });
  await expect(privacyLink).toHaveAttribute("href", /^\/empleos\/privacidad\?v=[0-9a-f-]{36}$/);
  await expect(publicPage.getByLabel(/^He leído y acepto el aviso de privacidad \(versión \d+\)$/)).toBeVisible();
  // El aviso fijado se muestra si es el vigente; una versión que ya no lo es avisa y muestra la actual.
  const pinned = await visitor.newPage();
  await pinned.goto((await privacyLink.getAttribute("href"))!);
  await expect(pinned.getByText("Esta versión ya no está vigente")).toHaveCount(0);
  await expect(pinned.getByText("Texto de prueba, sin validez legal.")).toBeVisible();
  await pinned.goto("/empleos/privacidad?v=00000000-0000-4000-8000-000000000000");
  await expect(pinned.getByText("Esta versión ya no está vigente; se muestra la actual")).toBeVisible();
  await expect(pinned.getByText("Texto de prueba, sin validez legal.")).toBeVisible();
  await pinned.close();
  await expect(privacyLink).toHaveAttribute("target", "_blank");
  const posting = JSON.parse((await publicPage.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
  expect(posting).toHaveProperty("directApply", true);
  // Casilla del aviso obligatoria, casilla de cartera desmarcada, campo trampa fuera de la vista.
  await expect(publicPage.getByLabel("Acepto que conserven mi CV para futuras vacantes (opcional)")).not.toBeChecked();
  await expect(publicPage.locator('input[name="website"]')).toHaveAttribute("tabindex", "-1");
  await expect(publicPage.locator('input[name="website"]')).toHaveAttribute("autocomplete", "off");

  // Errores accesibles sin enviar nada.
  await publicPage.getByRole("button", { name: "Enviar postulación" }).click();
  await expect(publicPage.getByText("Ingrese el nombre completo")).toBeVisible();
  await expect(publicPage.getByText("Adjunte su CV en PDF o Word.")).toBeVisible();
  await expect(publicPage.getByText("Debe aceptar el aviso de privacidad para postular")).toBeVisible();
  await expect(publicPage.getByLabel("Nombre completo")).toHaveAttribute("aria-invalid", "true");

  await fillForm(publicPage, { name: applicantName, email, phone, file: { name: "cv.pdf", mimeType: "application/pdf", buffer: pdf }, talentPool: true });
  const response = await submitAndWait(publicPage);
  expect(response.status()).toBe(200);
  await expect(publicPage.getByText(SUCCESS)).toBeVisible({ timeout: 30_000 });
  const reference = SUCCESS.exec((await publicPage.getByTestId("apply-reference").locator("xpath=..").textContent()) ?? "")![1]!;
  expect(await visitor.cookies()).toEqual([]);

  // Un archivo inválido muestra el error y no registra nada (otro envío, con el desafío ya renovado).
  await publicPage.goto(publicPath);
  await fillForm(publicPage, {
    name: `Invalido ${tag}`,
    email: `invalido.${tag.toLowerCase()}@correo.test`,
    phone: `9${String(Date.now() + 1).slice(-8)}`,
    file: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("esto no es un pdf") },
  });
  await submitAndWait(publicPage);
  await expect(publicPage.getByText("El archivo no es un PDF válido.")).toBeVisible({ timeout: 30_000 });
  await expect(publicPage.getByRole("alert").filter({ hasText: "Revise los datos ingresados." })).toBeVisible();
  await expect(publicPage.getByLabel(/^CV \(PDF o Word/)).toHaveAttribute("aria-invalid", "true");

  // Repetición con el mismo correo: la misma confirmación (otra referencia), sin pista de duplicado.
  await publicPage.goto(publicPath);
  const secondPdf = Buffer.from(await makePdf(pdfLines(secondName)));
  await fillForm(publicPage, {
    name: secondName,
    email,
    phone: `9${String(Date.now() + 2).slice(-8)}`,
    file: { name: "cv.pdf", mimeType: "application/pdf", buffer: secondPdf },
  });
  await submitAndWait(publicPage);
  await expect(publicPage.getByText(SUCCESS)).toBeVisible({ timeout: 30_000 });
  await expect(publicPage.getByText(/duplicad/i)).toHaveCount(0);
  expect(violations).toEqual([]);
  await visitor.close();

  // RRHH: bandeja con portal y método, evaluada, y referencia en la ficha.
  await page.goto("/postulaciones");
  const first = page.getByRole("row").filter({ hasText: applicantName });
  await expect(first).toHaveCount(1);
  await expect(first).toContainText("Página de empleos");
  await expect(first).toContainText("Formulario en línea");
  await expect(first).toContainText(title);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: applicantName })).toContainText("acreditado");
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("row").filter({ hasText: applicantName })).not.toContainText("Posible duplicado");
  const second = page.getByRole("row").filter({ hasText: secondName });
  await expect(second).toHaveCount(1);
  await expect(second).toContainText("Posible duplicado");
  await expect(second).toContainText("mismo correo");
  await expect(page.getByRole("row").filter({ hasText: `Invalido ${tag}` })).toHaveCount(0);

  // También en la tabla de la vacante.
  await page.goto(vacancyUrl);
  const vacancyRow = page.getByRole("row").filter({ hasText: secondName });
  await expect(vacancyRow).toContainText("Formulario en línea");
  await expect(vacancyRow).toContainText("Posible duplicado");

  await page.goto("/postulaciones");
  await page.getByRole("row").filter({ hasText: applicantName }).getByRole("link", { name: applicantName }).click();
  await expect(page.getByText(`Referencia: ${reference}`)).toBeVisible();
  await expect(page.getByText("Sistema (integración)").first()).toBeVisible();

  // Convocatoria cerrada: no ofrece el formulario.
  await page.goto(vacancyUrl);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText("Estado de la vacante actualizado.")).toBeVisible();
  const closedVisitor = await publicContext(browser);
  const closedPage = await closedVisitor.newPage();
  await closedPage.goto(publicPath);
  await expect(closedPage.getByText("Esta convocatoria ya no recibe postulaciones")).toBeVisible();
  await expect(closedPage.locator("form")).toHaveCount(0);
  await expect(closedPage.getByRole("link", { name: "Postular", exact: true })).toHaveCount(0);
  await closedVisitor.close();
});

test("móvil: el formulario cabe en pantalla, sin desplazamiento horizontal, y envía", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== "movil", "Se ejecuta con el dispositivo móvil (Pixel 7).");
  const tag = lettersOnly();
  const title = `Analista Postulacion ${tag}`;
  const applicantName = `Lucia ${tag} Mamani`;

  // La preparación usa contextos de escritorio; la parte pública, el dispositivo móvil del proyecto.
  const adminContext = await desktopContext(browser);
  await activateTestNotice(await adminContext.newPage(), `movil-${tag.toLowerCase()}`);
  await adminContext.close();
  const rrhhContext = await desktopContext(browser);
  const { publicPath } = await createPublishedVacancy(await rrhhContext.newPage(), title);
  await rrhhContext.close();

  const visitor = await publicContext(browser);
  const mobile = await visitor.newPage();
  await mobile.goto(publicPath);
  await expect(mobile.getByRole("heading", { name: "Postular a esta vacante" })).toBeVisible();
  await noHorizontalScroll(mobile);
  await mobile.getByRole("link", { name: "Postular", exact: true }).click();
  await expect(mobile).toHaveURL(/#postular$/);
  await noHorizontalScroll(mobile);

  // Con errores visibles tampoco hay desplazamiento.
  await mobile.getByRole("button", { name: "Enviar postulación" }).click();
  await expect(mobile.getByText("Ingrese el nombre completo")).toBeVisible();
  await noHorizontalScroll(mobile);

  const pdf = Buffer.from(await makePdf([applicantName, "Experiencia con SQL Server y reportes de gestión en proyectos de datos."]));
  await fillForm(mobile, {
    name: applicantName,
    email: `lucia.${tag.toLowerCase()}@correo.test`,
    phone: `9${String(Date.now()).slice(-8)}`,
    file: { name: "cv.pdf", mimeType: "application/pdf", buffer: pdf },
  });
  await submitAndWait(mobile);
  await expect(mobile.getByText(SUCCESS)).toBeVisible({ timeout: 30_000 });
  await noHorizontalScroll(mobile);
  await visitor.close();
});
