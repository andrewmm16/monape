import { describe, expect, it } from "vitest";
import {
  buildOutreachMessage,
  LINKEDIN_WEEKLY_SAFE_LIMIT,
  linkedinWindowStart,
  mailtoLink,
  RECRUITER_NAME,
  waLink,
} from "@/modules/caleta/outreach";

describe("mensaje de contacto de Caleta", () => {
  it("se presenta como Pedro Córdova y saluda por el primer nombre", () => {
    const text = buildOutreachMessage("Giancarlo Robles Rodriguez", "Ingeniero Sanitario", "linkedin");
    expect(RECRUITER_NAME).toBe("Pedro Córdova");
    expect(text).toContain("Soy Pedro Córdova");
    expect(text.startsWith("Buenas tardes, Giancarlo.")).toBe(true);
    expect(text).toContain("Ingeniero Sanitario");
  });

  it("por LinkedIn dice de dónde salió el contacto y no pide el número", () => {
    const text = buildOutreachMessage("Ana Pérez", "Ingeniero Civil (Junior)", "linkedin");
    expect(text).not.toContain("número de WhatsApp");
    expect(text).toContain("Vi su perfil en LinkedIn");
    expect(text).toContain("no le vuelvo a escribir");
  });

  it("por WhatsApp o correo no pide el número que ya se tiene", () => {
    const text = buildOutreachMessage("Ana Pérez", "Ingeniero Civil (Junior)", "whatsapp");
    expect(text).not.toContain("número de WhatsApp");
    expect(text).toContain("publicó este contacto");
    expect(text).toContain("no le vuelvo a escribir");
  });

  it("sin nombre usa un saludo genérico", () => {
    expect(buildOutreachMessage("   ", "Ingeniero Sanitario", "email").startsWith("Buenas tardes, ingeniero(a).")).toBe(true);
  });

  it("arma el enlace de WhatsApp solo con dígitos y el mensaje codificado", () => {
    const link = waLink("+51 945 181 045", "Junior Yauri", "Ingeniero Electromecánico");
    expect(link.startsWith("https://wa.me/51945181045?text=")).toBe(true);
    expect(decodeURIComponent(link.split("?text=")[1]!)).toContain("Soy Pedro Córdova");
  });

  it("arma el correo con asunto y cuerpo", () => {
    const link = mailtoLink("ana@example.com", "Ana Pérez", "Ingeniero Sanitario");
    expect(link.startsWith("mailto:ana@example.com?subject=")).toBe(true);
    expect(decodeURIComponent(link)).toContain("Soy Pedro Córdova");
  });
});

describe("ritmo de invitaciones de LinkedIn", () => {
  it("cuenta una ventana móvil de 7 días hacia atrás", () => {
    const now = new Date("2026-11-10T15:00:00Z");
    expect(linkedinWindowStart(now).toISOString()).toBe("2026-11-03T15:00:00.000Z");
    expect(LINKEDIN_WEEKLY_SAFE_LIMIT).toBe(100);
  });
});
