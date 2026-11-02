import { describe, expect, it } from "vitest";
import { loadConfig } from "../../bot/src/config";
import type { Cambio } from "../../bot/src/fake-portal/mutator";
import type { Incident } from "../../bot/src/incidents";
import { buildReport, renderHtml, renderMarkdown, renderText } from "../../bot/src/training-report";
import { createHealthSchedule, runCycle } from "../../bot/src/runner";
import { MemorySeenStore } from "../../bot/src/seen";
import type { PortalAdapter } from "../../bot/src/types";
import { MemoryApi } from "../fixtures/bot";

const at = (minutes: number) => new Date(Date.parse("2026-01-01T00:00:00Z") + minutes * 60_000).toISOString();

const cambio = (over: Partial<Cambio> & Pick<Cambio, "id" | "portal" | "mutacion" | "tipo">, minutes: number): Cambio => ({
  descripcion: "d",
  esperado: over.tipo === "cosmetica" ? [] : ["healthCheck", "publish"],
  estado: "activa",
  origen: "automatico",
  timestamp: at(minutes),
  ...over,
});

const incident = (over: Partial<Incident> & Pick<Incident, "id" | "portal" | "createdAt">): Incident => ({
  lastSeenAt: over.createdAt,
  occurrences: 1,
  step: "prueba_estructura",
  errorCode: "pagina_cambio",
  message: "falta #li-titulo en el paso 1 del asistente",
  reparable: true,
  structure: null,
  status: "abierto",
  ...over,
});

describe("informe de entrenamiento", () => {
  const cambios: Cambio[] = [
    cambio({ id: 1, portal: "linkedin", mutacion: "renombrar_campo", tipo: "estructural", estado: "restablecida" }, 0), // detectado a los 20 min
    cambio({ id: 2, portal: "bumeran", mutacion: "enlace_cv", tipo: "estructural", estado: "resuelta", esperado: ["cv"] }, 30), // escapado
    cambio({ id: 3, portal: "indeed", mutacion: "paso_extra", tipo: "estructural" }, 60), // activo y sin detectar aún
    cambio({ id: 4, portal: "trabajos-diarios", mutacion: "cosmetico_colores", tipo: "cosmetica" }, 90), // sin alarma
    cambio({ id: 5, portal: "computrabajo", mutacion: "cosmetico_tipografia", tipo: "cosmetica" }, 120), // falsa alarma
    cambio({ id: 6, portal: "linkedin", mutacion: "aviso_cookies", tipo: "estructural" }, 200), // detectado por repetición de un incidente abierto
  ];
  const incidentes: Incident[] = [
    incident({ id: 1, portal: "linkedin", createdAt: at(20) }),
    incident({ id: 2, portal: "bumeran", createdAt: at(10) }), // anterior al cambio 2: no cuenta
    incident({ id: 3, portal: "computrabajo", createdAt: at(125), step: "publicar", errorCode: "pagina_cambio" }),
    incident({ id: 4, portal: "indeed", createdAt: at(5) }), // anterior al cambio 3
    incident({ id: 5, portal: "linkedin", createdAt: at(150), lastSeenAt: at(230), occurrences: 3 }), // seguía abierto
  ];

  it("cruza cambios e incidentes: detectados, escapados, falsas alarmas y tiempos", () => {
    const report = buildReport(cambios, incidentes);
    const byId = (id: number) => [...report.estructurales, ...report.cosmeticos].find((row) => row.cambio.id === id)!;

    expect(byId(1).deteccion).toMatchObject({ incidente: 1, minutos: 20, codigo: "pagina_cambio", repeticion: false, enPasoEsperado: true });
    expect(byId(2).deteccion).toBeNull();
    expect(byId(3).deteccion).toBeNull();
    expect(byId(4).deteccion).toBeNull();
    expect(byId(5).deteccion).toMatchObject({ incidente: 3, minutos: 5, paso: "publicar" });
    // El incidente 1 pertenece al cambio 1 (el cambio 6 es posterior); el 5 lo repitió después del cambio 6.
    expect(byId(6).deteccion).toMatchObject({ incidente: 5, minutos: 30, repeticion: true });

    expect(report.totales).toEqual({
      estructurales: 4,
      detectados: 2,
      escapados: 1,
      sinDetectarAun: 1,
      tiempoMedioMin: 25,
      tiempoMaxMin: 30,
      cosmeticos: 2,
      falsasAlarmas: 1,
    });
  });

  it("no cuenta incidentes de otro portal ni posteriores al siguiente cambio del mismo portal", () => {
    const report = buildReport(
      [
        cambio({ id: 1, portal: "linkedin", mutacion: "renombrar_campo", tipo: "estructural", estado: "restablecida" }, 0),
        cambio({ id: 2, portal: "linkedin", mutacion: "texto_boton", tipo: "estructural" }, 60),
      ],
      [incident({ id: 1, portal: "bumeran", createdAt: at(10) }), incident({ id: 2, portal: "linkedin", createdAt: at(70) })],
    );
    expect(report.estructurales[0]!.deteccion).toBeNull();
    expect(report.estructurales[1]!.deteccion).toMatchObject({ incidente: 2, minutos: 10 });
  });

  it("escribe la tabla en texto y en Markdown, sin mensajes ni datos personales", () => {
    const report = buildReport(cambios, incidentes);
    const text = renderText(report);
    expect(text).toContain("INFORME DE ENTRENAMIENTO");
    expect(text).toContain("renombrar_campo");
    expect(text).toContain("20 min");
    expect(text).toContain("Estructurales: 4 · detectados: 2 · escapados: 1 · sin detectar aún (activos): 1");
    expect(text).toContain("Cosméticos: 2 · falsas alarmas: 1");
    expect(text).not.toContain("falta #li-titulo"); // el mensaje del incidente no se copia
    const md = renderMarkdown(report);
    expect(md).toContain("| N.º | Portal | Cambio |");
    expect(md).toContain("## Totales");
  });

  it("sin cambios no falla", () => {
    expect(renderText(buildReport([], []))).toContain("(sin cambios)");
  });
});

describe("informe: tasa por tipo de cambio, por portal y reanudaciones", () => {
  const cambios: Cambio[] = [
    cambio({ id: 1, portal: "linkedin", mutacion: "renombrar_campo", tipo: "estructural", estado: "restablecida", restablecida_auto: true, motivo: "detectado", restablecidaEn: at(25) }, 0),
    cambio({ id: 2, portal: "bumeran", mutacion: "renombrar_campo", tipo: "estructural", estado: "restablecida", restablecida_auto: true, motivo: "tiempo", restablecidaEn: at(90) }, 30),
    cambio({ id: 3, portal: "bumeran", mutacion: "enlace_cv", tipo: "estructural", estado: "restablecida", esperado: ["cv"] }, 100),
    cambio({ id: 4, portal: "indeed", mutacion: "cosmetico_colores", tipo: "cosmetica" }, 10),
    cambio({ id: 5, portal: "linkedin", mutacion: "cosmetico_tipografia", tipo: "cosmetica" }, 200),
  ];
  const incidentes: Incident[] = [
    incident({ id: 1, portal: "linkedin", createdAt: at(20), recoveredAt: at(31), recoveryNote: "volvió a pasar" }),
    incident({ id: 2, portal: "bumeran", createdAt: at(104), step: "descargar_cv" }),
    incident({ id: 3, portal: "indeed", createdAt: at(12) }),
  ];

  it("agrupa por tipo de cambio y por portal con tasa de detección y tiempo medio", () => {
    const report = buildReport(cambios, incidentes);
    expect(report.porMutacion).toEqual([
      { mutacion: "enlace_cv", aplicados: 1, detectados: 1, escapados: 0, sinDetectarAun: 0, tasaDeteccionPct: 100, tiempoMedioMin: 4 },
      { mutacion: "renombrar_campo", aplicados: 2, detectados: 1, escapados: 1, sinDetectarAun: 0, tasaDeteccionPct: 50, tiempoMedioMin: 20 },
    ]);
    expect(report.porPortal).toEqual([
      { portal: "bumeran", aplicados: 2, detectados: 1, escapados: 1, sinDetectarAun: 0, tasaDeteccionPct: 50, tiempoMedioMin: 4, cosmeticos: 0, falsasAlarmas: 0, reanudaciones: 0 },
      { portal: "indeed", aplicados: 0, detectados: 0, escapados: 0, sinDetectarAun: 0, tasaDeteccionPct: null, tiempoMedioMin: null, cosmeticos: 1, falsasAlarmas: 1, reanudaciones: 0 },
      { portal: "linkedin", aplicados: 1, detectados: 1, escapados: 0, sinDetectarAun: 0, tasaDeteccionPct: 100, tiempoMedioMin: 20, cosmeticos: 1, falsasAlarmas: 0, reanudaciones: 1 },
    ]);
  });

  it("una línea por reanudación: cuánto estuvo detenido el robot y cuánto tardó en volver tras restablecer el portal", () => {
    const report = buildReport(cambios, incidentes);
    expect(report.reanudaciones).toEqual([
      { cambio: 1, portal: "linkedin", mutacion: "renombrar_campo", incidente: 1, minutosDetenido: 11, minutosTrasRestablecer: 6 },
    ]);
    expect(report.resumenReanudaciones).toEqual({ total: 1, tiempoMedioMin: 6 });
    // Los totales de siempre no cambian de forma.
    expect(report.totales).toMatchObject({ estructurales: 3, detectados: 2, escapados: 1, falsasAlarmas: 1 });
  });

  it("el texto, el Markdown y el HTML llevan las tablas nuevas, los totales de reanudación y la hora de generación, sin mensajes", () => {
    const report = buildReport(cambios, incidentes);
    const options = { generadoEn: at(60) };
    const text = renderText(report, options);
    expect(text).toContain("Generado (UTC): 2026-01-01 01:00:00");
    expect(text).toContain("restablecida (auto: detectado)");
    expect(text).toContain("restablecida (auto: tiempo)");
    expect(text).toContain("Reanudaciones automáticas: 1 · tiempo medio en volver tras restablecer el portal: 6 min");

    const md = renderMarkdown(report, options);
    expect(md).toContain("## Detección por tipo de cambio estructural");
    expect(md).toContain("| enlace_cv | 1 | 1 | 0 | 0 | 100 % | 4 min |");
    expect(md).toContain("## Detección por portal");
    expect(md).toContain("## Reanudaciones automáticas del robot");
    expect(md).toContain("| #1 | linkedin | renombrar_campo | #1 | 11 min | 6 min |");
    expect(md).not.toContain("falta #li-titulo");

    const html = renderHtml(report, { ...options, refreshSeconds: 60 });
    expect(html).toContain("Generado (UTC): 2026-01-01 01:00:00");
    expect(html).toContain('<meta http-equiv="refresh" content="60">');
    expect(html).toContain("Reanudaciones automáticas: 1");
    expect(html).toContain("<td>50 %</td>");
  });

  it("sin reanudaciones el informe lo dice sin fallar", () => {
    const report = buildReport([], []);
    expect(report.resumenReanudaciones).toEqual({ total: 0, tiempoMedioMin: null });
    expect(renderMarkdown(report)).toContain("Reanudaciones automáticas: 0");
  });
});

describe("BOT_HEALTH_CHECK_HOURS con decimales", () => {
  const env = { BOT_API_URL: "http://localhost:3000", PORTAL_BOT_SECRET: "x".repeat(32) };

  it("la configuración acepta 0.5 (30 min) y el calendario lo respeta", () => {
    expect(loadConfig({ ...env, BOT_HEALTH_CHECK_HOURS: "0.5" }).healthCheckHours).toBe(0.5);
    expect(createHealthSchedule(0.5).intervalMs).toBe(30 * 60_000);
    expect(() => loadConfig({ ...env, BOT_HEALTH_CHECK_HOURS: "-1" })).toThrow();
  });

  it("con 0.5 la prueba corre en el primer ciclo, no antes de 30 min y sí a los 30", async () => {
    let checks = 0;
    const adapter = {
      slug: "x",
      healthCheck: async () => void checks++,
      publish: async () => ({ externalId: "1", externalUrl: "https://x.test/1" }),
      withdraw: async () => {},
      listApplicants: async () => [],
      downloadResume: async () => ({ filename: "cv.pdf", bytes: new Uint8Array() }),
      close: async () => {},
    } as PortalAdapter;
    let now = 1_000_000;
    const deps = { api: new MemoryApi(), adapter, seen: new MemorySeenStore(), log: () => {}, pauseMs: 0, maxJobs: 1, health: createHealthSchedule(0.5, () => now) };
    await runCycle(deps);
    expect(checks).toBe(1);
    now += 29 * 60_000;
    await runCycle(deps);
    expect(checks).toBe(1);
    now += 60_000;
    await runCycle(deps);
    expect(checks).toBe(2);
  });
});
