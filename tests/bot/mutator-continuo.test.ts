import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_CODES, PortalError } from "../../bot/src/errors";
import { mutacionesDe } from "../../bot/src/fake-portal/mutations";
import { createMutator } from "../../bot/src/fake-portal/mutator";
import { PORTAL_SLUGS, startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";
import { SITES } from "../../bot/src/fake-portal/sites";
import { FileIncidentStore, listIncidentsSync } from "../../bot/src/incidents";

/** Modo continuo del mutador (restablecer solo) y el informe automático del servidor; relojes manuales, sin esperas reales. */
const MIN = 60_000;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mutador-continuo-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const clock = (start = Date.parse("2026-01-01T00:00:00Z")) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};
const iso = (ms: number) => new Date(ms).toISOString();
const incidentOf = (portal: string, at: string, lastSeenAt = at) => ({ portal, createdAt: at, lastSeenAt });

describe("modo continuo: restablecer solo", () => {
  function setup() {
    const time = clock();
    const incidents: ReturnType<typeof incidentOf>[] = [];
    const mutator = createMutator({ seed: 4, now: time.now, autoRestore: { graceMs: 3 * MIN, maxLifeMs: 60 * MIN }, incidents: () => incidents });
    return { time, incidents, mutator };
  }

  it("por detección: espera el margen desde que el robot notó el cambio y devuelve el portal al original", () => {
    const { time, incidents, mutator } = setup();
    const { cambio } = mutator.tick();
    expect(cambio).toMatchObject({ portal: "linkedin", tipo: "estructural", origen: "automatico" });
    expect(mutator.siteOf("linkedin")).not.toBe(SITES.linkedin);

    // No cuentan: un incidente de otro portal ni uno anterior al cambio (que no se repitió después).
    incidents.push(incidentOf("bumeran", iso(time.now() + MIN)), incidentOf("linkedin", iso(time.now() - 5 * MIN)));
    time.advance(10 * MIN);
    expect(mutator.sweep()).toEqual([]);

    // El robot lo detecta a los 10 min; a los 12 aún no pasó el margen de 3 min.
    incidents.push(incidentOf("linkedin", iso(time.now())));
    time.advance(2 * MIN);
    expect(mutator.sweep()).toEqual([]);
    expect(mutator.state().activas).toHaveLength(1);

    time.advance(1 * MIN);
    const [restored] = mutator.sweep();
    expect(restored).toMatchObject({
      id: cambio!.id,
      estado: "restablecida",
      restablecida_auto: true,
      motivo: "detectado",
      restablecidaEn: iso(time.now()),
      resueltaEn: iso(time.now()),
    });
    expect(mutator.siteOf("linkedin")).toBe(SITES.linkedin);
    expect(mutator.state().activas).toHaveLength(0);
  });

  it("también cuenta la repetición de un incidente anterior que sigue abierto (mismo criterio que el informe)", () => {
    const { time, incidents, mutator } = setup();
    mutator.tick();
    incidents.push(incidentOf("linkedin", iso(time.now() - 30 * MIN), iso(time.now() + 1 * MIN)));
    time.advance(1 * MIN);
    mutator.sweep(); // lo nota aquí
    time.advance(3 * MIN);
    expect(mutator.sweep().map((c) => c.motivo)).toEqual(["detectado"]);
  });

  it("por absorción: si el robot usó un selector alternativo (sin incidente), se restablece tras el margen sin esperar el máximo de vida", () => {
    const time = clock();
    const tolerances: { portal: string; timestamp: string }[] = [];
    const mutator = createMutator({ seed: 4, now: time.now, autoRestore: { graceMs: 3 * MIN, maxLifeMs: 60 * MIN }, incidents: () => [], tolerances: () => tolerances });
    const { cambio } = mutator.tick();
    expect(cambio).toMatchObject({ portal: "linkedin", tipo: "estructural" });

    // No cuentan: tolerancia de otro portal ni anterior al cambio.
    tolerances.push({ portal: "bumeran", timestamp: iso(time.now() + MIN) }, { portal: "linkedin", timestamp: iso(time.now() - 5 * MIN) });
    time.advance(10 * MIN);
    expect(mutator.sweep()).toEqual([]);

    tolerances.push({ portal: "linkedin", timestamp: iso(time.now()) });
    time.advance(2 * MIN);
    expect(mutator.sweep()).toEqual([]); // aún dentro del margen

    time.advance(1 * MIN);
    const [restored] = mutator.sweep();
    expect(restored).toMatchObject({ id: cambio!.id, estado: "restablecida", restablecida_auto: true, motivo: "absorbido" });
    expect(mutator.siteOf("linkedin")).toBe(SITES.linkedin);
  });

  it("si además hay incidente, manda la detección (no se cuenta como absorbido)", () => {
    const time = clock();
    const incidents: ReturnType<typeof incidentOf>[] = [];
    const tolerances: { portal: string; timestamp: string }[] = [{ portal: "linkedin", timestamp: iso(time.now() + 1 * MIN) }];
    const mutator = createMutator({ seed: 4, now: time.now, autoRestore: { graceMs: 3 * MIN, maxLifeMs: 60 * MIN }, incidents: () => incidents, tolerances: () => tolerances });
    mutator.tick();
    time.advance(2 * MIN);
    incidents.push(incidentOf("linkedin", iso(time.now())));
    expect(mutator.sweep()).toEqual([]);
    time.advance(3 * MIN);
    expect(mutator.sweep().map((c) => c.motivo)).toEqual(["detectado"]);
  });

  it("por tiempo: sin detección, al llegar al máximo de vida", () => {
    const { time, mutator } = setup();
    mutator.tick();
    time.advance(59 * MIN);
    expect(mutator.sweep()).toEqual([]);
    time.advance(1 * MIN);
    expect(mutator.sweep().map((c) => c.motivo)).toEqual(["tiempo"]);
    expect(mutator.state().cambios[0]).toMatchObject({ estado: "restablecida", restablecida_auto: true, motivo: "tiempo" });
  });

  it("el tope de 2 se libera solo y el siguiente turno puede aplicar otro estructural", () => {
    const { time, mutator } = setup();
    mutator.tick(); // linkedin
    mutator.tick(); // bumeran
    mutator.tick(); // trabajos-diarios: cosmético (turno 3)
    const fourth = mutator.tick(); // indeed: ya hay 2 estructurales
    expect(fourth.omision?.motivo).toContain("ya hay 2 portales");
    expect(mutator.state().activas.filter((c) => c.tipo === "estructural")).toHaveLength(2);

    time.advance(61 * MIN);
    const fifth = mutator.tick(); // computrabajo: el turno empieza liberando a los dos
    expect(fifth.cambio).toMatchObject({ portal: "computrabajo", tipo: "estructural" });
    const state = mutator.state();
    expect(state.cambios.filter((c) => c.restablecida_auto).map((c) => c.motivo)).toEqual(["tiempo", "tiempo"]);
    expect(state.activas.filter((c) => c.tipo === "estructural").map((c) => c.portal)).toEqual(["computrabajo"]);
  });

  it("un turno sobre un portal con estructural activo no apila otro y lo anota en omitidos", () => {
    const { mutator } = setup();
    const first = mutator.tick().cambio!;
    for (let i = 0; i < PORTAL_SLUGS.length - 1; i++) mutator.tick();
    const again = mutator.tick(); // vuelve a linkedin, que sigue con su estructural
    expect(again.cambio).toBeUndefined();
    expect(again.omision?.motivo).toContain("ya tiene un cambio estructural");
    expect(mutator.state().omitidos.some((o) => o.portal === first.portal)).toBe(true);
    expect(mutator.state().cambios.filter((c) => c.portal === first.portal && c.tipo === "estructural")).toHaveLength(1);
  });

  it("al restablecer un estructural conserva el cosmético activo del portal; lo forzado a mano no se restablece solo", () => {
    const { time, mutator } = setup();
    mutator.apply("linkedin", "cosmetico_colores"); // manual
    mutator.apply("bumeran", "paso_extra"); // manual: se queda
    const { cambio } = mutator.tick(); // linkedin: estructural automático
    expect(cambio).toMatchObject({ portal: "linkedin", tipo: "estructural" });
    time.advance(61 * MIN);
    expect(mutator.sweep().map((c) => c.id)).toEqual([cambio!.id]);
    expect(mutator.siteOf("linkedin").variant).toEqual({ cosmetico: "colores" });
    expect(mutator.state().activas.map((c) => c.mutacion).sort()).toEqual(["cosmetico_colores", "paso_extra"]);
  });

  it("sin la opción autoRestore nada se restablece solo (modo anterior)", () => {
    const time = clock();
    const mutator = createMutator({ seed: 4, now: time.now, incidents: () => [incidentOf("linkedin", iso(time.now() + MIN))] });
    mutator.tick();
    time.advance(500 * MIN);
    expect(mutator.sweep()).toEqual([]);
    expect(mutator.state().restablecimientoAuto).toBeNull();
    expect(mutator.state().activas).toHaveLength(1);
  });

  it("recorre todo el catálogo que aplica a cada portal antes de repetir una mutación", () => {
    const { time, mutator } = setup();
    const structural: Record<string, string[]> = {};
    const cosmetic: Record<string, string[]> = {};
    for (let turn = 0; turn < 600; turn++) {
      const { cambio } = mutator.tick();
      time.advance(61 * MIN); // cada turno empieza con los portales libres
      if (!cambio) continue;
      const into = cambio.tipo === "estructural" ? structural : cosmetic;
      (into[cambio.portal] ??= []).push(cambio.mutacion);
    }
    for (const portal of PORTAL_SLUGS) {
      const catalog = mutacionesDe(portal, "estructural").map((m) => m.id);
      const seq = structural[portal]!;
      expect(seq.length).toBeGreaterThanOrEqual(catalog.length * 3);
      for (let round = 0; round < 3; round++) {
        expect(seq.slice(round * catalog.length, (round + 1) * catalog.length).sort()).toEqual([...catalog].sort());
      }
      const cosmetics = mutacionesDe(portal, "cosmetica").map((m) => m.id);
      expect(cosmetic[portal]!.slice(0, cosmetics.length).sort()).toEqual([...cosmetics].sort());
    }
  });

  it("los 5 portales siguen en rotación y la misma semilla da la misma secuencia", () => {
    const run = () => {
      const { time, mutator } = setup();
      const seen: string[] = [];
      for (let turn = 0; turn < 40; turn++) {
        const { cambio } = mutator.tick();
        time.advance(61 * MIN);
        if (cambio) seen.push(`${cambio.portal}:${cambio.mutacion}`);
      }
      return seen;
    };
    const seq = run();
    expect(seq).toEqual(run());
    expect(new Set(seq.slice(0, 5).map((s) => s.split(":")[0]))).toEqual(new Set(PORTAL_SLUGS));
  });

  it("con incidentes reales del robot (FileIncidentStore) detecta y restablece tras el margen", async () => {
    const time = clock();
    const incidentsDir = path.join(dir, "incidentes");
    const store = new FileIncidentStore(incidentsDir, () => {}, undefined, () => new Date(time.now()));
    const mutator = createMutator({
      seed: 4,
      now: time.now,
      autoRestore: { graceMs: 3 * MIN, maxLifeMs: 60 * MIN },
      incidents: () => listIncidentsSync(incidentsDir),
    });
    mutator.tick();
    time.advance(2 * MIN);
    await store.record({ portal: "linkedin", step: "prueba_estructura", error: new PortalError(ERROR_CODES.pageChanged, "falta un campo") });
    time.advance(2 * MIN);
    expect(mutator.sweep()).toEqual([]);
    time.advance(1 * MIN);
    expect(mutator.sweep().map((c) => c.motivo)).toEqual(["detectado"]);
  });

  it("el temporizador de revisión restablece solo y se apaga al detenerlo", () => {
    vi.useFakeTimers();
    try {
      const time = clock();
      const mutator = createMutator({ seed: 4, now: time.now, autoRestore: { maxLifeMs: 10 * MIN, sweepMs: 15_000 } });
      mutator.start();
      expect(mutator.running).toBe(false); // sin intervalo de cambios no hay programador, solo la revisión
      mutator.tick();
      time.advance(11 * MIN);
      vi.advanceTimersByTime(15_000);
      expect(mutator.state().activas).toHaveLength(0);
      mutator.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("informe automático del servidor", () => {
  let portal: FakePortal;
  afterEach(() => portal.close());

  async function untilFile(file: string, ms = 3_000) {
    for (let waited = 0; waited < ms && !existsSync(file); waited += 25) await new Promise((resolve) => setTimeout(resolve, 25));
    return existsSync(file);
  }

  it("escribe informe-entrenamiento.md (atómico, regenerado por el temporizador) y lo sirve en /__fake/informe", async () => {
    const incidentsDir = path.join(dir, "incidentes");
    const reportFile = path.join(dir, "estado", "informe-entrenamiento.md");
    portal = await startFakePortal(0, {
      mutation: { diaryFile: path.join(dir, "mutaciones.json"), incidentsDir, reportFile, reportMinutes: 0.0005, seed: 2 },
    });
    expect(await untilFile(reportFile)).toBe(true);
    expect(readFileSync(reportFile, "utf8")).toContain("# Informe de entrenamiento");
    expect(readFileSync(reportFile, "utf8")).toContain("Generado (UTC)");

    // El temporizador lo vuelve a crear solo.
    rmSync(reportFile);
    expect(await untilFile(reportFile)).toBe(true);
    expect(readdirSync(path.dirname(reportFile))).toEqual(["informe-entrenamiento.md"]); // sin temporales

    // Un cambio y su incidente: el informe actualizado los cuenta.
    const applied = (await (await fetch(`${portal.url}/__fake/mutaciones/aplicar?portal=linkedin&cambio=renombrar_campo`)).json()) as { timestamp: string };
    mkdirSync(incidentsDir, { recursive: true });
    const at = new Date(Date.parse(applied.timestamp) + 2 * MIN).toISOString();
    const incident = {
      id: 1,
      createdAt: at,
      lastSeenAt: at,
      occurrences: 1,
      portal: "linkedin",
      step: "prueba_estructura",
      errorCode: "pagina_cambio",
      message: "mensaje que no debe aparecer",
      reparable: true,
      structure: null,
      status: "abierto",
    };
    writeFileSync(path.join(incidentsDir, "0001.json"), JSON.stringify(incident));
    const page = await fetch(`${portal.url}/__fake/informe?actualizar=1`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain("Informe de entrenamiento");
    expect(html).toContain("Generado (UTC)");
    expect(html).toContain("Estructurales: 1 · detectados: 1");
    expect(html).toContain("Detección por tipo de cambio estructural");
    expect(html).toContain("Detección por portal");
    expect(html).toContain("renombrar_campo");
    expect(html).not.toContain("mensaje que no debe aparecer");

    // El panel enlaza el informe y muestra la hora de generación y los totales.
    const panel = await (await fetch(`${portal.url}/`)).text();
    expect(panel).toContain('href="/__fake/informe"');
    expect(panel).toMatch(/generado [^:]+:[^:]+:[^:]+: detectados 1 · escapados 0 · falsas alarmas 0/);
    expect(panel).toContain("reanudaciones 0");
  });

  it("sin archivo de informe, /__fake/informe y el panel calculan el informe actual", async () => {
    portal = await startFakePortal(0, { mutation: { seed: 2 } });
    await fetch(`${portal.url}/__fake/mutaciones/aplicar?portal=indeed&cambio=aviso_cookies`);
    expect(await (await fetch(`${portal.url}/__fake/informe`)).text()).toContain("aviso_cookies");
    expect(await (await fetch(`${portal.url}/`)).text()).toContain("Modo continuo apagado");
  });

  it("el panel describe el modo continuo cuando está activo", async () => {
    portal = await startFakePortal(0, { mutation: { seed: 2, autoRestore: { graceMs: 3 * MIN, maxLifeMs: 60 * MIN } } });
    expect(await (await fetch(`${portal.url}/`)).text()).toContain("3 min después de que el robot lo detecta, o a los 60 min");
    expect(portal.mutator.state().restablecimientoAuto).toEqual({ graciaMin: 3, vidaMaxMin: 60 });
  });
});
