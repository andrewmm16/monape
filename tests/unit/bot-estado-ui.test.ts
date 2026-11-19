import { describe, expect, it } from "vitest";
import type { BotPortalStatus } from "@/modules/portals/queries";
import { estadoGeneralRobot, estadoUi, resumenDiarioLinea } from "@/modules/portals/estado-ui";

const status = (over: Partial<BotPortalStatus>): BotPortalStatus => ({
  portalName: "Portal",
  nivel: "ok",
  reason: null,
  seenAt: null,
  ...over,
});

describe("texto y color de cada portal en el semáforo", () => {
  it("ok → verde, «Trabajando bien»", () => {
    expect(estadoUi(status({ nivel: "ok" }))).toEqual({ tono: "verde", etiqueta: "Trabajando bien" });
  });

  it("sin datos → gris", () => {
    expect(estadoUi(status({ nivel: "sin_datos" }))).toMatchObject({ tono: "gris" });
  });

  it("error → rojo, menciona al técnico", () => {
    const ui = estadoUi(status({ nivel: "error", reason: "pagina_cambio" }));
    expect(ui.tono).toBe("rojo");
    expect(ui.etiqueta.toLowerCase()).toContain("técnico");
  });

  it("sesión vencida → amarillo, pide iniciar sesión", () => {
    const ui = estadoUi(status({ nivel: "atencion", reason: "sesion_expirada" }));
    expect(ui.tono).toBe("amarillo");
    expect(ui.etiqueta.toLowerCase()).toContain("sesión");
  });

  it("sin señal → amarillo, menciona la PC", () => {
    const ui = estadoUi(status({ nivel: "atencion", reason: "sin_senal" }));
    expect(ui.tono).toBe("amarillo");
    expect(ui.etiqueta.toLowerCase()).toContain("pc");
  });

  it("atención con causa desconocida → amarillo genérico", () => {
    expect(estadoUi(status({ nivel: "atencion", reason: "algo_raro" }))).toMatchObject({ tono: "amarillo" });
  });
});

describe("frase del resumen del día", () => {
  const ok = status({ nivel: "ok" });
  const atencion = status({ portalName: "Computrabajo", nivel: "atencion", reason: "sesion_expirada" });

  it("todo bien: cuenta y «todos los portales están bien»", () => {
    const linea = resumenDiarioLinea({ publishedToday: 3, applicantsToday: 12 }, [ok, ok]);
    expect(linea).toContain("3");
    expect(linea).toContain("12");
    expect(linea.toLowerCase()).toContain("todos los portales");
  });

  it("singular: 1 vacante, 1 postulante", () => {
    const linea = resumenDiarioLinea({ publishedToday: 1, applicantsToday: 1 }, [ok]);
    expect(linea).toContain("1 vacante ");
    expect(linea).toContain("1 postulante ");
  });

  it("con portales en atención, dice cuántos necesitan atención", () => {
    const linea = resumenDiarioLinea({ publishedToday: 0, applicantsToday: 0 }, [ok, atencion]);
    expect(linea.toLowerCase()).toContain("1 portal necesita");
  });

  it("sin actividad lo dice de forma clara", () => {
    const linea = resumenDiarioLinea({ publishedToday: 0, applicantsToday: 0 }, [ok]);
    expect(linea.toLowerCase()).toContain("no publicó");
  });

  it("si ningún portal se ha conectado aún, lo indica", () => {
    const linea = resumenDiarioLinea({ publishedToday: 0, applicantsToday: 0 }, [status({ nivel: "sin_datos" })]);
    expect(linea.toLowerCase()).toContain("no se ha conectado");
  });
});

describe("estado general del robot para quienes usan la app", () => {
  it("todos bien → encendido", () => {
    expect(estadoGeneralRobot([status({}), status({ portalName: "B" })])).toEqual({ estado: "encendido", portalesEnReparacion: [] });
  });

  it("ningún portal da señales → apagado", () => {
    const silencio = { nivel: "atencion" as const, reason: "sin_senal" };
    expect(estadoGeneralRobot([status(silencio), status({ ...silencio, portalName: "B" })]).estado).toBe("apagado");
  });

  it("algún portal falló o calla, y otros trabajan → en reparación, con los afectados", () => {
    expect(
      estadoGeneralRobot([
        status({ portalName: "LinkedIn" }),
        status({ portalName: "Computrabajo", nivel: "error", reason: "selector_roto" }),
        status({ portalName: "Indeed", nivel: "atencion", reason: "sin_senal" }),
      ]),
    ).toEqual({ estado: "reparacion", portalesEnReparacion: ["Computrabajo", "Indeed"] });
  });

  it("nunca se conectó → sin datos (los portales sin datos no cuentan)", () => {
    expect(estadoGeneralRobot([status({ nivel: "sin_datos" })]).estado).toBe("sin_datos");
    expect(estadoGeneralRobot([status({ nivel: "sin_datos" }), status({ portalName: "B" })]).estado).toBe("encendido");
  });
});
