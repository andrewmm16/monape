import { afterEach, describe, expect, it, vi } from "vitest";

const BASE_ENV = {
  APP_URL: "http://localhost:3100",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59999",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ficticia_para_pruebas_000",
};

async function loadRobots(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...env })) vi.stubEnv(key, value);
  return (await import("@/app/robots")).default();
}

afterEach(() => vi.unstubAllEnvs());

describe("robots.txt", () => {
  it("apagada bloquea todo", async () => {
    expect(await loadRobots({ PUBLIC_JOBS_ENABLED: "false" })).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("encendida permite /empleos y los recursos estáticos, bloquea el resto y publica el sitemap", async () => {
    const robots = await loadRobots({
      PUBLIC_JOBS_ENABLED: "true",
      PUBLIC_SITE_URL: "https://empleos.ejemplo.test/",
      PUBLIC_COMPANY_NAME: "Empresa Ficticia",
    });
    expect(robots).toEqual({
      rules: { userAgent: "*", allow: ["/empleos", "/_next/static/"], disallow: "/" },
      sitemap: "https://empleos.ejemplo.test/sitemap.xml",
    });
  });
});
