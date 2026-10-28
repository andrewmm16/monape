import { defineConfig, devices } from "@playwright/test";
import { E2E_INTAKE_HASH_SECRET } from "./tests/fixtures/online-apply";
import { E2E_TALENT_APPLY_SECRET, E2E_TALENT_FEED_TOKEN } from "./tests/fixtures/talent-apply";

/**
 * Pruebas de interfaz.
 *
 * - tests/e2e/publico.spec.ts: no requieren Supabase. Se ejecutan contra un
 *   servidor de producción local con configuración ficticia.
 * - tests/e2e/empleos.spec.ts: páginas públicas (2.9). Con backend real el
 *   servidor arranca con la parte pública encendida (valores ficticios); sin
 *   backend queda apagada y publico.spec.ts comprueba que responde 404.
 * - tests/e2e/talent-apply.spec.ts: recepción de Talent Apply (2.10). Con backend
 *   real el servidor arranca con la función encendida y dos secretos ficticios
 *   (los mismos que usa la prueba para calcular el token de la vacante).
 * - tests/e2e/postulacion.spec.ts: formulario público de postulación (2.2). Con
 *   backend real el servidor arranca con PUBLIC_APPLY_ENABLED=true y un secreto
 *   ficticio; sin backend queda apagado y publico.spec.ts lo comprueba.
 * - tests/e2e/flujo-rrhh.spec.ts: requieren un proyecto Supabase de pruebas con
 *   las migraciones y los datos ficticios (`npm run db:seed`). Se omiten si no
 *   se definen E2E_RRHH_EMAIL y E2E_RRHH_PASSWORD.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const usesRealBackend = Boolean(process.env.E2E_RRHH_EMAIL);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // Las pruebas comparten la base de datos (aviso vigente, límites): una por vez.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    locale: "es-PE",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
    { name: "movil", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/ingresar`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: usesRealBackend
      ? {
          // Parte pública (2.9) encendida con valores ficticios para empleos.spec.ts.
          PUBLIC_JOBS_ENABLED: "true",
          PUBLIC_SITE_URL: `http://localhost:${PORT}`,
          PUBLIC_COMPANY_NAME: "Empresa Ficticia E2E",
          // Recepción de Talent Apply (2.10), con secretos ficticios.
          TALENT_APPLY_ENABLED: "true",
          TALENT_APPLY_SECRET: E2E_TALENT_APPLY_SECRET,
          TALENT_FEED_TOKEN: E2E_TALENT_FEED_TOKEN,
          // Formulario público de postulación (2.2), con un secreto ficticio.
          PUBLIC_APPLY_ENABLED: "true",
          INTAKE_HASH_SECRET: E2E_INTAKE_HASH_SECRET,
        }
      : {
          NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59999",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ficticia_para_pruebas_000",
          APP_URL: `http://localhost:${PORT}`,
          NEXT_TELEMETRY_DISABLED: "1",
          // Apagadas de forma explícita: .env.local puede encenderlas en local.
          PUBLIC_JOBS_ENABLED: "false",
          TALENT_APPLY_ENABLED: "false",
          PUBLIC_APPLY_ENABLED: "false",
        },
  },
});
