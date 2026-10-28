import { expect, test, type Page } from "@playwright/test";

/**
 * Páginas públicas de vacantes (2.9) contra un proyecto Supabase de PRUEBAS.
 * Requiere la parte pública encendida: playwright.config.ts la enciende con
 * valores ficticios cuando se definen E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD.
 * El caso "apagada → 404" está en publico.spec.ts.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

const DESCRIPTION =
  "Descripción ficticia de la vacante de pruebas: análisis de información y elaboración de reportes para las áreas usuarias.";

async function signIn(page: Page) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(rrhh.email!);
  await page.getByLabel("Contraseña").fill(rrhh.password!);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/panel/);
}

/** Crea una vacante en borrador con los datos de publicación y la publica. */
async function createAndPublish(page: Page, title: string, options: { confidential?: boolean } = {}) {
  await page.goto("/vacantes/nueva");
  await page.getByLabel("Título del puesto").fill(title);
  await page.getByLabel("Área o departamento").fill("Pruebas");
  await page.getByLabel("Descripción", { exact: true }).fill(DESCRIPTION);
  await page.getByLabel("Ciudad", { exact: true }).fill("Lima");
  await page.getByLabel("Región", { exact: true }).fill("Lima");
  await page.getByLabel("Tipo de empleo").selectOption({ label: "Tiempo completo" });
  if (options.confidential) await page.getByLabel(/^Confidencial/).click();
  await page.getByRole("button", { name: "Crear vacante" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Estado de la vacante actualizado.")).toBeVisible();
}

test("publicar, ocultar una confidencial y cerrar: página, JSON-LD, listado y feed", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  test.setTimeout(90_000);
  const tag = Date.now().toString(36);
  const openTitle = `Analista Publico ${tag}`;
  const secretTitle = `Analista Reservado ${tag}`;
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load)/i.test(message.text())) violations.push(message.text());
  });

  await signIn(page);
  await createAndPublish(page, openTitle);
  const vacancyUrl = page.url().split("?")[0]!;
  await createAndPublish(page, secretTitle, { confidential: true });
  await expect(page.getByText("Vacante confidencial")).toBeVisible();

  // La ficha de la pública ofrece el enlace a su página.
  await page.goto(vacancyUrl);
  const publicLink = page.getByRole("link", { name: /\/empleos\/analista-publico-/ });
  await expect(publicLink).toBeVisible();
  const publicUrl = await publicLink.getAttribute("href");
  expect(publicUrl).toMatch(/\/empleos\/analista-publico-[a-z0-9]+-[a-z0-9]{10}$/);

  // Listado: aparece la pública y no la confidencial.
  await page.goto("/empleos");
  await expect(page.getByRole("link", { name: openTitle })).toBeVisible();
  await expect(page.getByText(secretTitle)).toHaveCount(0);

  // Página: datos estructurados y postulación. El formulario (2.2) solo se ofrece con
  // un aviso de privacidad vigente, que depende de otras pruebas (privacidad.spec.ts):
  // sin él se mantiene el botón deshabilitado y el aviso de siempre.
  await page.getByRole("link", { name: openTitle }).click();
  await expect(page.getByRole("heading", { name: openTitle })).toBeVisible();
  // Espera a que la página termine de cargar (formulario o botón deshabilitado) antes de decidir.
  await expect(page.locator("#postular form, button:has-text('Postular')").first()).toBeVisible();
  const offersForm = (await page.locator("#postular form").count()) > 0;
  if (offersForm) {
    await expect(page.getByRole("link", { name: "Postular", exact: true })).toHaveAttribute("href", "#postular");
  } else {
    await expect(page.getByRole("button", { name: "Postular" })).toBeDisabled();
    await expect(page.getByText("Las postulaciones en línea se habilitarán próximamente")).toBeVisible();
  }
  const posting = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}");
  expect(posting).toMatchObject({
    "@type": "JobPosting",
    title: openTitle,
    employmentType: "FULL_TIME",
    hiringOrganization: { name: "Empresa Ficticia E2E" },
    jobLocation: { address: { addressLocality: "Lima", addressCountry: "PE" } },
  });
  if (offersForm) expect(posting).toHaveProperty("directApply", true);
  else expect(posting).not.toHaveProperty("directApply");
  const code = new URL(page.url()).pathname.slice(-10);

  // Feed, sitemap y robots.
  const feed = await request.get("/empleos/feed.xml");
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("xml");
  expect(feed.headers()["cache-control"]).toContain("max-age=300");
  expect(feed.headers()["cache-control"]).toContain("s-maxage=300");
  // Con sesión iniciada, las rutas públicas no tocan cookies (son cacheables).
  expect(feed.headers()["set-cookie"]).toBeUndefined();
  const sessionFeed = await page.request.get("/empleos/feed.xml");
  expect(sessionFeed.headers()["set-cookie"]).toBeUndefined();
  expect((await page.request.get("/empleos")).headers()["set-cookie"]).toBeUndefined();
  const feedXml = await feed.text();
  expect(feedXml).toContain(`<title>${openTitle}</title>`);
  expect(feedXml).toContain(`<referencenumber>${code}</referencenumber>`);
  expect(feedXml).not.toContain(secretTitle);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(code);
  expect(sitemap).not.toContain("reservado");
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /empleos");
  expect(robots).toContain("Disallow: /");

  // Al cerrarla sale del listado y del feed; su página avisa y no se indexa.
  await page.goto(vacancyUrl);
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText("Estado de la vacante actualizado.")).toBeVisible();

  await page.goto("/empleos");
  await expect(page.getByText(openTitle)).toHaveCount(0);
  expect(await (await request.get("/empleos/feed.xml")).text()).not.toContain(openTitle);
  expect(await (await request.get("/sitemap.xml")).text()).not.toContain(code);

  await page.goto(publicUrl!);
  await expect(page.getByText("Esta convocatoria ya no recibe postulaciones")).toBeVisible();
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(violations).toEqual([]);
});

test("las direcciones sin vacante responden 404", async ({ request }) => {
  expect((await request.get("/empleos/no-existe-aaaaaaaaaa")).status()).toBe(404);
  expect((await request.get("/empleos/sin-codigo")).status()).toBe(404);
});
