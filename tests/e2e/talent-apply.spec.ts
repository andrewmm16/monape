import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { makePdf } from "../fixtures/documents";
import { E2E_TALENT_APPLY_SECRET, E2E_TALENT_FEED_TOKEN } from "../fixtures/talent-apply";

/**
 * Recepción de Talent Apply (2.10) contra un proyecto Supabase de PRUEBAS con
 * las migraciones aplicadas (incluida 20261028000300_talent_apply.sql) y el
 * servidor arrancado por playwright.config.ts con la función encendida y
 * secretos ficticios. Usa las mismas variables que carga-masiva.spec.ts.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };

test.skip(!rrhh.email || !rrhh.password, "Requiere un proyecto Supabase de pruebas (E2E_RRHH_EMAIL / E2E_RRHH_PASSWORD).");

/** Solo letras: así el nombre no se confunde con cifras. */
function lettersOnly(): string {
  const raw = Date.now().toString(26).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)));
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Mismo cálculo que el servidor: HMAC-SHA256("talent-apply:" + código), base64url, 32 caracteres. */
function vacancyToken(code: string): string {
  return createHmac("sha256", E2E_TALENT_APPLY_SECRET).update(`talent-apply:${code}`).digest("base64url").slice(0, 32);
}

test("Talent Apply: feed con talent-apply-data, postulación evaluada en la bandeja, repetición y tokens incorrectos", async ({ page, request, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== "escritorio", "El flujo completo se ejecuta una vez.");
  const tag = lettersOnly();
  const title = `Analista Talent ${tag}`;
  const applicantName = `Rosa ${tag} Quispe`;
  const externalId = `e2e-${Date.now()}`;

  // Vacante publicada con criterios aprobados (para que se evalúe al recibirla).
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

  // Feed con el token correcto: trae el <talent-apply-data> de la vacante.
  const feed = await request.get(`/api/integraciones/talent/feed/${E2E_TALENT_FEED_TOKEN}`);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["cache-control"]).toBe("private, no-store");
  expect(feed.headers()["x-robots-tag"]).toBe("noindex");
  const xml = await feed.text();
  const job = [...xml.matchAll(/<job>[\s\S]*?<\/job>/g)].map((match) => match[0]).find((block) => block.includes(`<title>${title}</title>`));
  expect(job, "la vacante publicada debe estar en el feed").toBeTruthy();
  const code = /<referencenumber>([a-z0-9]{10})<\/referencenumber>/.exec(job!)![1]!;
  const data = /<talent-apply-data><!\[CDATA\[([\s\S]*?)\]\]><\/talent-apply-data>/.exec(job!);
  expect(data, "el job debe llevar talent-apply-data").toBeTruthy();
  const postPath = `/api/integraciones/talent/postular/${code}/${vacancyToken(code)}`;
  expect(data![1]).toBe(`talent-apply-posturl=${encodeURIComponent(`${baseURL}${postPath}`)}`);

  // Feed con token incorrecto: 404.
  expect((await request.get(`/api/integraciones/talent/feed/${E2E_TALENT_FEED_TOKEN}x`)).status()).toBe(404);
  expect((await request.get("/api/integraciones/talent/feed/incorrecto")).status()).toBe(404);

  // Postulación: el servidor de Talent.com envía un POST JSON con el CV en base64.
  const pdf = await makePdf([
    applicantName,
    "Analista de datos",
    "Experiencia con SQL Server, reportes y modelado de datos en proyectos de gestión.",
    "Formación en ingeniería industrial y manejo de herramientas de análisis.",
  ]);
  const payload = {
    id: externalId,
    applicant: {
      fullName: applicantName,
      phoneNumber: `9${String(Date.now()).slice(-8)}`,
      email: `rosa.${tag.toLowerCase()}@correo.test`,
      resume: {
        file: { fileName: "rosa.pdf", contentType: "application/pdf", data: Buffer.from(pdf).toString("base64") },
      },
    },
    job: { jobCompany: "Empresa Ficticia E2E", jobId: code, jobLocation: "Lima", jobTitle: title },
    analytics: { ip: "203.0.113.7", useragent: "Mozilla/5.0 (E2E)", device: "desktop" },
  };
  const first = await request.post(postPath, { data: payload });
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ status: "ok" });

  // La misma postulación (mismo id) no se duplica.
  const repeated = await request.post(postPath, { data: payload });
  expect(repeated.status()).toBe(200);
  expect(await repeated.json()).toEqual({ status: "ok" });

  // Token incorrecto o de otra vacante: 404 sin detalle.
  const wrongToken = await request.post(`/api/integraciones/talent/postular/${code}/${vacancyToken(code).slice(0, 31)}x`, { data: payload });
  expect(wrongToken.status()).toBe(404);
  expect(await wrongToken.text()).toBe("");
  expect((await request.post(`/api/integraciones/talent/postular/${code}/${vacancyToken("otrocodigo1")}`, { data: payload })).status()).toBe(404);

  // Debe ser JSON y un CV inválido se rechaza con 422.
  const notJson = await request.post(postPath, { headers: { "content-type": "text/plain" }, data: "hola" });
  expect(notJson.status()).toBe(415);
  const invalidCv = await request.post(postPath, {
    data: { ...payload, id: `${externalId}-invalido`, applicant: { ...payload.applicant, resume: { file: { fileName: "x.pdf", data: Buffer.from("no es un pdf").toString("base64") } } } },
  });
  expect(invalidCv.status()).toBe(422);

  // Bandeja: una sola fila, con Talent.com, Integración y evaluada.
  await page.goto("/postulaciones");
  const rows = page.getByRole("row").filter({ hasText: applicantName });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Talent.com");
  await expect(rows).toContainText("Integración");
  await expect(rows).toContainText("acreditado");
  await expect(rows).toContainText(title);

  // También en la tabla de la vacante.
  await page.goto(`${vacancyUrl}`);
  const vacancyRow = page.getByRole("row").filter({ hasText: applicantName });
  await expect(vacancyRow).toHaveCount(1);
  await expect(vacancyRow).toContainText("Talent.com");

  // Los eventos sin usuario se muestran como «Sistema (integración)».
  await page.goto("/postulaciones");
  await page.getByRole("row").filter({ hasText: applicantName }).getByRole("link", { name: applicantName }).click();
  await expect(page.getByText("Sistema (integración)").first()).toBeVisible();
});
