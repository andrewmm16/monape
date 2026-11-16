import { describe, expect, it } from "vitest";
import { loadConfig } from "../../bot/src/config";
import { withinWorkHours, withJitter } from "../../bot/src/schedule";

describe("horario de trabajo (hora de Perú)", () => {
  it("sin horario ni días configurados, siempre trabaja", () => {
    const always = { hours: null, days: null };
    expect(withinWorkHours(new Date("2026-11-07T06:00:00Z"), always)).toBe(true);
  });

  it("respeta la franja horaria (fin exclusivo)", () => {
    const work = { hours: { start: 8, end: 20 }, days: null };
    expect(withinWorkHours(new Date("2026-11-06T12:00:00Z"), work)).toBe(false); // 07:00 Lima
    expect(withinWorkHours(new Date("2026-11-06T14:00:00Z"), work)).toBe(true); // 09:00 Lima
    expect(withinWorkHours(new Date("2026-11-07T00:59:00Z"), work)).toBe(true); // 19:59 Lima
    expect(withinWorkHours(new Date("2026-11-07T01:00:00Z"), work)).toBe(false); // 20:00 Lima
  });

  it("respeta los días hábiles (ISO: lunes=1 … domingo=7)", () => {
    const work = { hours: null, days: [1, 2, 3, 4, 5] };
    // 2026-11-06 es viernes; 2026-11-07 es sábado (en Lima).
    expect(withinWorkHours(new Date("2026-11-06T15:00:00Z"), work)).toBe(true);
    expect(withinWorkHours(new Date("2026-11-07T15:00:00Z"), work)).toBe(false);
  });
});

describe("pausa con variación (jitter)", () => {
  it("sin jitter devuelve la pausa base", () => {
    expect(withJitter(2000, 0, () => 0.5)).toBe(2000);
  });

  it("aplica ± la fracción según el azar", () => {
    expect(withJitter(2000, 0.4, () => 0.5)).toBe(2000); // centro
    expect(withJitter(2000, 0.4, () => 1)).toBe(2800); // +40%
    expect(withJitter(2000, 0.4, () => 0)).toBe(1200); // -40%
  });
});

describe("loadConfig: horario y jitter", () => {
  const base = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };

  it("por defecto trabaja siempre y sin jitter", () => {
    const config = loadConfig(base);
    expect(config.work).toEqual({ hours: null, days: null });
    expect(config.pauseJitter).toBe(0);
  });

  it("acepta franja horaria y días", () => {
    const config = loadConfig({ ...base, BOT_WORK_HOURS: "8-20", BOT_WORK_DAYS: "1-5" });
    expect(config.work).toEqual({ hours: { start: 8, end: 20 }, days: [1, 2, 3, 4, 5] });
  });

  it("rechaza franjas y días inválidos", () => {
    expect(() => loadConfig({ ...base, BOT_WORK_HOURS: "20-8" })).toThrow(/BOT_WORK_HOURS/);
    expect(() => loadConfig({ ...base, BOT_WORK_HOURS: "8-25" })).toThrow(/BOT_WORK_HOURS/);
    expect(() => loadConfig({ ...base, BOT_WORK_DAYS: "0-5" })).toThrow(/BOT_WORK_DAYS/);
  });

  it("acepta el jitter entre 0 y 1 y rechaza lo demás", () => {
    expect(loadConfig({ ...base, BOT_PAUSE_JITTER: "0.4" }).pauseJitter).toBe(0.4);
    expect(() => loadConfig({ ...base, BOT_PAUSE_JITTER: "1.5" })).toThrow(/BOT_PAUSE_JITTER/);
  });
});
