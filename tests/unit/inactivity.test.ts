import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createActivityCookieValue, readActivityTime } from "@/lib/auth/activity-cookie";
import { IDLE_TIMEOUT_MS, isServerIdleExpired, SERVER_IDLE_TIMEOUT_MS, serverIdleMs } from "@/lib/auth/inactivity";

const NOW = 1_800_000_000_000;
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

describe("inactividad registrada en el servidor", () => {
  it("calcula el tiempo desde la última actividad", () => {
    expect(serverIdleMs(NOW - 5_000, NOW)).toBe(5_000);
  });

  it("sin hora válida o con hora futura, la sesión se da por vencida", () => {
    for (const value of [null, NOW + 10 * 60_000]) {
      expect(serverIdleMs(value, NOW)).toBeNull();
      expect(isServerIdleExpired(value, NOW)).toBe(true);
    }
  });

  it("tolera diferencias pequeñas de reloj entre servidores", () => {
    expect(serverIdleMs(NOW + 30_000, NOW)).toBe(0);
    expect(isServerIdleExpired(NOW + 30_000, NOW)).toBe(false);
  });

  it("vence después del límite del servidor, que deja margen sobre el aviso del navegador", () => {
    expect(SERVER_IDLE_TIMEOUT_MS).toBeGreaterThan(IDLE_TIMEOUT_MS);
    expect(isServerIdleExpired(NOW - IDLE_TIMEOUT_MS, NOW)).toBe(false);
    expect(isServerIdleExpired(NOW - SERVER_IDLE_TIMEOUT_MS, NOW)).toBe(false);
    expect(isServerIdleExpired(NOW - SERVER_IDLE_TIMEOUT_MS - 1, NOW)).toBe(true);
  });
});

describe("cookie de actividad firmada", () => {
  beforeAll(() => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_ficticia_para_pruebas_000");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_ficticia_para_pruebas_0000000");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("devuelve la hora de una cookie auténtica del mismo usuario", () => {
    expect(readActivityTime(createActivityCookieValue(USER, NOW), USER)).toBe(NOW);
  });

  it("rechaza cookies editadas, de otro usuario o mal formadas", () => {
    const value = createActivityCookieValue(USER, NOW - 40 * 60_000);
    const signature = value.split(".")[1]!;
    expect(readActivityTime(`${NOW}.${signature}`, USER)).toBeNull();
    expect(readActivityTime(createActivityCookieValue(OTHER_USER, NOW), USER)).toBeNull();
    for (const malformed of [undefined, "", String(NOW), `${NOW}.`, `${NOW}.abc`, `x${value}`, `${value}x`]) {
      expect(readActivityTime(malformed, USER)).toBeNull();
    }
  });
});
