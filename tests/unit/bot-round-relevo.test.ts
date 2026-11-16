import { describe, expect, it } from "vitest";
import type { AdapterSlot } from "../../bot/src/round";
import { allStopped, isWaitingHuman } from "../../bot/src/round";

const slot = (over: Partial<AdapterSlot>): AdapterSlot => ({ slug: "x", halted: false, deps: {} as never, ...over });

describe("portal en espera de verificación humana", () => {
  it("un código de verificación o sesión vencida cuentan como «esperando a una persona»", () => {
    expect(isWaitingHuman(slot({ halted: true, haltReason: "verificacion_requerida" }))).toBe(true);
    expect(isWaitingHuman(slot({ halted: true, haltReason: "sesion_expirada" }))).toBe(true);
  });

  it("un cambio de página o un portal activo no lo son", () => {
    expect(isWaitingHuman(slot({ halted: true, haltReason: "pagina_cambio" }))).toBe(false);
    expect(isWaitingHuman(slot({ halted: false }))).toBe(false);
  });
});

describe("el robot no se apaga mientras espera una verificación", () => {
  it("si algún portal espera «listo», no está todo detenido (sigue vivo)", () => {
    const slots = [slot({ halted: true, haltReason: "pagina_cambio" }), slot({ halted: true, haltReason: "verificacion_requerida" })];
    expect(allStopped(slots)).toBe(false);
  });

  it("si todo está detenido y nada espera verificación, sí termina", () => {
    const slots = [slot({ halted: true, haltReason: "pagina_cambio" }), slot({ halted: true, haltReason: "fallos_seguidos" })];
    expect(allStopped(slots)).toBe(true);
  });
});
