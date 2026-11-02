import { describe, expect, it } from "vitest";
import { loadConfig } from "../../bot/src/config";
import { parseCommand } from "../../bot/src/notify/commands";
import { BotControl } from "../../bot/src/notify/control";

describe("parseCommand", () => {
  it("acepta solo órdenes exactas, sin importar mayúsculas, tildes ni signos", () => {
    expect(parseCommand("estado")).toBe("estado");
    expect(parseCommand("  ESTADO! ")).toBe("estado");
    expect(parseCommand("/pausar")).toBe("pausar");
    expect(parseCommand("Reanudar.")).toBe("reanudar");
    expect(parseCommand("ahora")).toBe("ahora");
    expect(parseCommand("ayuda")).toBe("ayuda");
  });

  it("ignora texto libre y órdenes dentro de otras frases", () => {
    expect(parseCommand("estado del robot")).toBeNull();
    expect(parseCommand("por favor pausar")).toBeNull();
    expect(parseCommand("borrar todo")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

describe("BotControl", () => {
  it("pausar y reanudar cambian el estado; reanudar pide un ciclo inmediato", () => {
    const control = new BotControl("fake");
    control.handle("pausar");
    expect(control.paused).toBe(true);
    control.handle("reanudar");
    expect(control.paused).toBe(false);
    expect(control.consumeWake()).toBe(true);
    expect(control.consumeWake()).toBe(false);
  });

  it("«ahora» no hace nada en pausa y pide un ciclo si está activo", () => {
    const control = new BotControl("fake");
    control.handle("pausar");
    expect(control.handle("ahora")).toContain("pausa");
    expect(control.consumeWake()).toBe(false);
    control.handle("reanudar");
    control.consumeWake();
    control.handle("ahora");
    expect(control.consumeWake()).toBe(true);
  });

  it("«estado» informa pausa, último ciclo y fallos seguidos", () => {
    const control = new BotControl("fake", new Date("2026-10-30T10:00:00Z"));
    expect(control.handle("estado")).toContain("Aún no termina ningún ciclo");
    control.recordCycle("correcto", new Date("2026-10-30T10:05:00Z"));
    control.consecutiveCycleFailures = 2;
    control.paused = true;
    const reply = control.handle("estado");
    expect(reply).toContain("EN PAUSA");
    expect(reply).toContain("correcto");
    expect(reply).toContain("Ciclos fallidos seguidos: 2");
  });

  it("«ayuda» lista las órdenes", () => {
    const reply = new BotControl("fake").handle("ayuda");
    for (const word of ["estado", "pausar", "reanudar", "ahora"]) expect(reply).toContain(word);
  });
});

describe("loadConfig: BOT_NOTIFY_PHONE", () => {
  const base = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };

  it("sin número no hay avisos", () => {
    expect(loadConfig(base).notifyPhone).toBeNull();
  });

  it("acepta solo dígitos con código de país", () => {
    expect(loadConfig({ ...base, BOT_NOTIFY_PHONE: "51999999999" }).notifyPhone).toBe("51999999999");
    for (const bad of ["+51999999999", "999 999 999", "0999999999", "abc"]) {
      expect(() => loadConfig({ ...base, BOT_NOTIFY_PHONE: bad })).toThrow(/BOT_NOTIFY_PHONE/);
    }
  });
});
