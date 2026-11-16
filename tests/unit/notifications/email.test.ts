import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const baseEnv = {
  APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "x".repeat(24),
};

async function load(extra: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_DELIVERY_MODE"]) vi.stubEnv(key, "");
  for (const [k, v] of Object.entries({ ...baseEnv, ...extra })) vi.stubEnv(k, v);
  const config = await import("@/modules/notifications/email/config");
  const client = await import("@/modules/notifications/email/client");
  return { ...config, ...client };
}

const mail = { to: "a@b.com", subject: "s", html: "<p>h</p>", text: "t" };

describe("correo", () => {
  beforeEach(() => send.mockReset());

  it("está apagado en modo test", async () => {
    const { getEmailAvailability } = await load({ EMAIL_DELIVERY_MODE: "test", RESEND_API_KEY: "k", EMAIL_FROM: "a@b.c" });
    expect(getEmailAvailability().available).toBe(false);
  });

  it("modo live sin clave falla la validación del entorno", async () => {
    const { getEmailAvailability } = await load({ EMAIL_DELIVERY_MODE: "live", EMAIL_FROM: "a@b.c" });
    expect(() => getEmailAvailability()).toThrow(/RESEND_API_KEY/);
  });

  it("está disponible en live con clave y remitente", async () => {
    const { getEmailAvailability } = await load({ EMAIL_DELIVERY_MODE: "live", RESEND_API_KEY: "k", EMAIL_FROM: "RRHH <a@b.c>" });
    expect(getEmailAvailability()).toMatchObject({ available: true, from: "RRHH <a@b.c>", mode: "live" });
  });

  it("sendEmail en modo test no envía ni lanza", async () => {
    const { sendEmail } = await load({ EMAIL_DELIVERY_MODE: "test" });
    const result = await sendEmail(mail);
    expect(result.sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("sendEmail en live envía y no lanza si Resend falla", async () => {
    const { sendEmail } = await load({ EMAIL_DELIVERY_MODE: "live", RESEND_API_KEY: "k", EMAIL_FROM: "a@b.c" });
    send.mockResolvedValueOnce({ data: { id: "1" }, error: null });
    expect(await sendEmail(mail)).toEqual({ sent: true });
    send.mockRejectedValueOnce(new Error("boom"));
    expect(await sendEmail(mail)).toEqual({ sent: false });
  });
});
