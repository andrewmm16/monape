import { expect, test } from "@playwright/test";

/**
 * Pruebas sin backend: protección de rutas, cabeceras de seguridad y
 * validaciones de formularios públicos.
 */

test.describe("protección de rutas privadas", () => {
  for (const path of ["/panel", "/vacantes", "/candidatos", "/usuarios", "/configuracion/privacidad", "/empleosx", "/postulaciones/2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10"]) {
    test(`sin sesión, ${path} redirige al ingreso`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/ingresar/);
      const url = new URL(page.url());
      expect(url.searchParams.get("next")).toBe(path);
      await expect(page.getByRole("heading", { name: "Ingresar" })).toBeVisible();
    });
  }

  test("la descarga de CV sin sesión responde 401 sin datos", async ({ request }) => {
    const response = await request.get("/api/resumes/2b1c1f8e-6a0b-4f53-9a1c-3c5f0f6f1a10/download", { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ error: "No autenticado" });
  });

  test("la salida por cuenta desactivada sin sesión no cierra nada y lleva al ingreso", async ({ page }) => {
    await page.goto("/auth/cuenta-desactivada");
    await expect(page).toHaveURL(/\/ingresar$/);
  });

  test("los enlaces de confirmación inválidos no redirigen a sitios externos", async ({ page }) => {
    await page.goto("/auth/confirm?type=recovery&token_hash=invalido&next=https://malicioso.test");
    await expect(page).toHaveURL(/\/ingresar\?motivo=enlace-invalido/);
    await expect(page.getByText("El enlace no es válido o expiró")).toBeVisible();
  });
});

test.describe("parte pública apagada", () => {
  // Con backend real, playwright.config.ts enciende la parte pública (ver empleos.spec.ts).
  test.skip(Boolean(process.env.E2E_RRHH_EMAIL), "La parte pública está encendida en este modo.");

  test("/empleos, el feed y las vacantes responden 404 sin pedir sesión", async ({ request }) => {
    for (const path of ["/empleos", "/empleos/feed.xml", "/empleos/privacidad", "/empleos/analista-abc123def4"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
    }
  });

  test("sin backend el formulario de postulación no se ofrece: ni el desafío ni la página responden", async ({ request }) => {
    const challenge = await request.get("/empleos/desafio/abc123def4", { maxRedirects: 0 });
    expect(challenge.status()).toBe(404);
    expect(challenge.headers()["cache-control"]).toContain("no-store");
    const page = await request.get("/empleos/analista-abc123def4", { maxRedirects: 0 });
    expect(page.status()).toBe(404);
    expect(await page.text()).not.toContain("apply-full-name");
  });

  test("robots.txt bloquea todo y el sitemap queda vacío", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const text = await robots.text();
    expect(text).toContain("Disallow: /");
    expect(text).not.toContain("Allow:");
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).not.toContain("<url>");
  });
});

test.describe("cabeceras de seguridad", () => {
  test("la página de ingreso envía CSP con nonce y cabeceras restrictivas", async ({ request }) => {
    const response = await request.get("/ingresar");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("la aplicación funciona con la CSP activa (sin scripts bloqueados)", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to (execute|load)/i.test(message.text())) violations.push(message.text());
    });
    await page.goto("/ingresar");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Correo inválido")).toBeVisible();
    expect(violations).toEqual([]);
  });
});

test.describe("formularios públicos", () => {
  test("no existe registro público de usuarios", async ({ page }) => {
    await page.goto("/ingresar");
    await expect(page.getByRole("link", { name: /registr|crear cuenta/i })).toHaveCount(0);
  });

  test("el ingreso valida los datos en el servidor", async ({ page }) => {
    await page.goto("/ingresar");
    await page.getByLabel("Correo corporativo").fill("no-es-un-correo");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("Correo inválido")).toBeVisible();
    await expect(page.getByText("Ingrese su contraseña")).toBeVisible();
    // El correo ingresado se conserva tras el error; la contraseña nunca se devuelve.
    await expect(page.getByLabel("Correo corporativo")).toHaveValue("no-es-un-correo");
  });

  test("si el servicio de autenticación no responde, lo informa sin aparentar éxito", async ({ page }) => {
    await page.goto("/ingresar");
    await page.getByLabel("Correo corporativo").fill("persona.ficticia@ejemplo.test");
    await page.getByLabel("Contraseña").fill("ContraseñaFicticia123");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText("El servicio de autenticación no está disponible")).toBeVisible();
    await expect(page).toHaveURL(/\/ingresar/);
  });

  test("la recuperación de contraseña responde igual exista o no la cuenta", async ({ page }) => {
    await page.goto("/recuperar");
    await page.getByLabel("Correo corporativo").fill("x");
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByText("Correo inválido")).toBeVisible();
    await page.getByLabel("Correo corporativo").fill("persona.ficticia@ejemplo.test");
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByText("Si el correo pertenece a una cuenta activa")).toBeVisible();
  });

  test("la página de ingreso no genera desplazamiento horizontal", async ({ page }) => {
    await page.goto("/ingresar");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
