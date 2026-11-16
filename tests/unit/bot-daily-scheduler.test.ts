import { describe, expect, it } from "vitest";
import { dailySummaryMessage, dueDailySummary, limaDateKey } from "../../bot/src/notify/daily-summary";
import { loadNotifyConfig } from "../../bot/src/config";

describe("clave de día en hora de Perú", () => {
  it("usa el día local de Lima (UTC-5)", () => {
    expect(limaDateKey(new Date("2026-11-06T02:00:00Z"))).toBe("2026-11-05");
    expect(limaDateKey(new Date("2026-11-06T18:00:00Z"))).toBe("2026-11-06");
  });
});

describe("¿toca enviar el resumen diario?", () => {
  const hour = 8;
  // 2026-11-06T14:00Z = 09:00 en Lima (ya pasó la hora 8).
  const manana = new Date("2026-11-06T14:00:00Z");

  it("sí, si aún no se envió hoy y ya pasó la hora", () => {
    expect(dueDailySummary({ now: manana, hour, lastSentDate: null })).toBe(true);
  });

  it("no, si ya se envió hoy", () => {
    expect(dueDailySummary({ now: manana, hour, lastSentDate: "2026-11-06" })).toBe(false);
  });

  it("no, si todavía no llega la hora", () => {
    // 2026-11-06T11:00Z = 06:00 en Lima (antes de las 8).
    expect(dueDailySummary({ now: new Date("2026-11-06T11:00:00Z"), hour, lastSentDate: null })).toBe(false);
  });

  it("sí, si la última vez fue ayer y ya pasó la hora (la PC estuvo apagada)", () => {
    expect(dueDailySummary({ now: manana, hour, lastSentDate: "2026-11-05" })).toBe(true);
  });
});

describe("mensaje del resumen por WhatsApp", () => {
  it("reenvía la frase con un encabezado", () => {
    const msg = dailySummaryMessage("Hoy: 1 vacante publicada y 0 postulantes recibidos. ✅ Todos los portales están bien.");
    expect(msg).toContain("Resumen");
    expect(msg).toContain("1 vacante");
  });
});

describe("configuración del resumen diario", () => {
  it("por defecto a las 8", () => {
    expect(loadNotifyConfig({}).dailySummaryHour).toBe(8);
  });
  it("«off» lo desactiva", () => {
    expect(loadNotifyConfig({ BOT_DAILY_SUMMARY_HOUR: "off" }).dailySummaryHour).toBeNull();
  });
  it("acepta una hora entre 0 y 23", () => {
    expect(loadNotifyConfig({ BOT_DAILY_SUMMARY_HOUR: "7" }).dailySummaryHour).toBe(7);
  });
  it("rechaza una hora inválida", () => {
    expect(() => loadNotifyConfig({ BOT_DAILY_SUMMARY_HOUR: "25" })).toThrow();
  });
});
