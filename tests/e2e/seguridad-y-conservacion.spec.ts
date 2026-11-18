import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { E2E_CRON_SECRET } from "../fixtures/scheduled-tasks";

/**
 * Tareas programadas, plazo de conservación y portal del candidato, contra el proyecto Supabase de PRUEBAS. Crea sus
 * propios usuarios y candidatos con la clave de servicio.
 */
const rrhh = { email: process.env.E2E_RRHH_EMAIL, password: process.env.E2E_RRHH_PASSWORD };
const admin = { email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD };
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test.skip(
  !rrhh.email || !admin.email || !supabaseUrl || !serviceKey || !publishableKey,
  "Requiere el proyecto Supabase de pruebas y la clave de servicio.",
);
test.describe.configure({ mode: "serial" });

const service = () => createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo corporativo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  // Espera a que el ingreso termine antes de navegar.
  await page.waitForURL(/\/panel/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Menú de usuario" }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/ingresar/);
}

test("las tareas programadas exigen el secreto y responden solo contadores", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "escritorio", "Se ejecuta una vez.");
  for (const path of ["/api/tareas/recordatorios-entrevista", "/api/tareas/limpieza-cv?simular=1"]) {
    expect((await request.get(path)).status()).toBe(404);
    expect((await request.get(path, { headers: { Authorization: "Bearer otro-secreto-que-no-es" } })).status()).toBe(404);
  }
  const reminders = await request.get("/api/tareas/recordatorios-entrevista", {
    headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` },
  });
  expect(reminders.status()).toBe(200);
  // En las pruebas el correo está en modo de prueba: la tarea no reserva nada.
  expect(await reminders.json()).toMatchObject({ status: "omitida" });

  const sweep = await request.get("/api/tareas/limpieza-cv?simular=1", { headers: { Authorization: `Bearer ${E2E_CRON_SECRET}` } });
  expect(sweep.status()).toBe(200);
  expect(await sweep.json()).toMatchObject({ simulated: true, removed: 0, failed: 0 });
});

test("plazo de conservación: la administración anonimiza a un candidato inactivo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "escritorio", "Se ejecuta una vez.");
  const suffix = Date.now().toString(36);
  const name = `Inactivo Antiguo ${suffix}`;
  // Alta con fechas de hace 3 años (al insertar no hay disparador que las reemplace).
  const threeYearsAgo = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidate, error } = await service()
    .from("candidates")
    .insert({ full_name: name, email: `inactivo.${suffix}@correo.test`, created_at: threeYearsAgo, updated_at: threeYearsAgo })
    .select("id")
    .single();
  expect(error).toBeNull();

  await signIn(page, rrhh.email!, rrhh.password!);
  await page.goto("/candidatos/conservacion");
  await expect(page.getByRole("heading", { name: "Acceso restringido" })).toBeVisible();
  await signOut(page);

  await signIn(page, admin.email!, admin.password!);
  await page.goto("/candidatos");
  await page.getByRole("link", { name: "Plazo de conservación" }).click();
  await expect(page.getByRole("heading", { name: "Plazo de conservación" })).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("Sin constancia");
  await row.getByRole("button", { name: "Anonimizar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Anonimizar" }).click();
  await expect(page.getByText("Candidato anonimizado.")).toBeVisible();
  await expect(row).toHaveCount(0);

  await page.goto(`/candidatos/${candidate!.id}`);
  await expect(page.getByRole("heading", { name: /^Persona anonimizada / })).toBeVisible();
  await expect(page.getByText(`inactivo.${suffix}@correo.test`)).toHaveCount(0);
});

test("portal del candidato: apagado por defecto, enlace privado y apagado de nuevo", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(testInfo.project.name !== "escritorio", "Se ejecuta una vez.");
  await signIn(page, admin.email!, admin.password!);
  await expect(page).toHaveURL(/\/panel/);

  // Una postulación cualquiera de los datos ficticios.
  const { data: application } = await service()
    .from("applications")
    .select("id, candidate_id, vacancies(title)")
    .limit(1)
    .single();
  const vacancyTitle = (application!.vacancies as unknown as { title: string }).title;

  // Apagado: la ficha no ofrece el enlace.
  await page.goto(`/candidatos/${application!.candidate_id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enlace de seguimiento" })).toHaveCount(0);

  await page.goto("/configuracion");
  await page.getByRole("link", { name: /^Portal del candidato/ }).click();
  await expect(page.getByText("Apagado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Encender" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Encender" }).click();
  await expect(page.getByText("Encendido", { exact: true })).toBeVisible();

  await page.goto(`/candidatos/${application!.candidate_id}`);
  await page.getByRole("button", { name: "Enlace de seguimiento" }).first().click();
  const url = await page.getByLabel("Enlace de seguimiento").first().inputValue();
  expect(url).toMatch(/\/seguimiento\/[0-9a-f]{64}$/);

  // La persona candidata lo abre sin sesión.
  const visitor = await browser.newContext();
  const candidatePage = await visitor.newPage();
  const shown = await candidatePage.goto(url);
  expect(shown?.status()).toBe(200);
  await expect(candidatePage.getByRole("heading", { name: vacancyTitle })).toBeVisible();
  await expect(candidatePage.getByRole("list", { name: "Etapas del proceso" }).or(candidatePage.getByText(/proceso de selección para este puesto terminó/))).toBeVisible();

  // Apagado: el mismo enlace ya no muestra nada.
  await page.goto("/configuracion/portal-candidato");
  await page.getByRole("button", { name: "Apagar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Apagar" }).click();
  await expect(page.getByText("Apagado", { exact: true })).toBeVisible();
  const hidden = await candidatePage.goto(url);
  expect(hidden?.status()).toBe(404);
  expect((await candidatePage.goto("/seguimiento/no-es-un-token"))?.status()).toBe(404);
  await visitor.close();
});
