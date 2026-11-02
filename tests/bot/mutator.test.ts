import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_STRUCTURAL, createMutator } from "../../bot/src/fake-portal/mutator";
import { SITES } from "../../bot/src/fake-portal/sites";
import { PORTAL_SLUGS, startFakePortal, type FakePortal } from "../../bot/src/fake-portal/server";

/** El mutador sin navegador: rotación, tope, determinismo, resolución, diario y endpoints. */
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mutador-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const clock = (start = Date.parse("2026-01-01T00:00:00Z")) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("programador de turnos", () => {
  it("rota los portales de uno en uno, 2 estructurales por cada cosmético, y cambia un solo portal por turno", () => {
    const mutator = createMutator({ seed: 7 });
    const seen: string[] = [];
    for (let turn = 1; turn <= 6; turn++) {
      const before = mutator.state().cambios.length;
      const { cambio } = mutator.tick();
      expect(mutator.state().cambios.length - before).toBe(1);
      seen.push(`${cambio!.portal}:${cambio!.tipo}`);
      // Resuelve para que el tope no interfiera en este recorrido.
      mutator.resolve(cambio!.portal);
    }
    expect(seen.map((s) => s.split(":")[0])).toEqual([...PORTAL_SLUGS, PORTAL_SLUGS[0]]);
    expect(seen.map((s) => s.split(":")[1])).toEqual(["estructural", "estructural", "cosmetica", "estructural", "estructural", "cosmetica"]);
  });

  it("nunca hay más de 2 portales con un estructural sin resolver y el turno lo registra", () => {
    const mutator = createMutator({ seed: 1 });
    for (let turn = 0; turn < 30; turn++) {
      mutator.tick();
      const portals = new Set(mutator.state().activas.filter((c) => c.tipo === "estructural").map((c) => c.portal));
      expect(portals.size).toBeLessThanOrEqual(MAX_STRUCTURAL);
    }
    const state = mutator.state();
    expect(new Set(state.activas.filter((c) => c.tipo === "estructural").map((c) => c.portal)).size).toBe(MAX_STRUCTURAL);
    expect(state.omitidos.some((o) => o.motivo.includes("ya hay 2 portales"))).toBe(true);
    expect(state.omitidos.some((o) => o.motivo.includes("ya tiene un cambio estructural"))).toBe(true);

    // Al resolver uno, el siguiente turno vuelve a poder aplicar un estructural.
    const [first] = state.activas.filter((c) => c.tipo === "estructural");
    mutator.resolve(first!.portal);
    let applied = false;
    for (let turn = 0; turn < 15 && !applied; turn++) applied = mutator.tick().cambio?.tipo === "estructural";
    expect(applied).toBe(true);
  });

  it("con la misma semilla da la misma secuencia; con otra, distinta", () => {
    const run = (seed: number) => {
      const mutator = createMutator({ seed });
      for (let turn = 0; turn < 20; turn++) {
        const { cambio } = mutator.tick();
        if (turn % 4 === 3 && cambio) mutator.resolve(cambio.portal);
      }
      return mutator.state().cambios.map((c) => `${c.portal}:${c.mutacion}`);
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("un estructural persiste hasta resolverlo y el turno de su portal no le suma otro", () => {
    const mutator = createMutator({ seed: 3 });
    const { cambio } = mutator.tick();
    expect(cambio!.tipo).toBe("estructural");
    for (let turn = 0; turn < PORTAL_SLUGS.length * 2; turn++) mutator.tick();
    expect(mutator.state().cambios.find((c) => c.id === cambio!.id)!.estado).toBe("activa");
    expect(mutator.state().cambios.filter((c) => c.portal === cambio!.portal && c.tipo === "estructural")).toHaveLength(1);
  });
});

describe("variantes, restablecer y resolver", () => {
  it("sin cambios el sitio es el original; restablecer vuelve a él", () => {
    const mutator = createMutator();
    expect(mutator.siteOf("linkedin")).toBe(SITES.linkedin);
    mutator.apply("linkedin", "paso_extra");
    expect(mutator.siteOf("linkedin")).not.toBe(SITES.linkedin);
    expect(mutator.siteOf("linkedin").steps).toHaveLength(SITES.linkedin.steps.length + 1);
    expect(SITES.linkedin.steps).toHaveLength(4); // el original no se toca nunca
    const restored = mutator.restore("linkedin");
    expect(restored.map((c) => c.estado)).toEqual(["restablecida"]);
    expect(mutator.siteOf("linkedin")).toBe(SITES.linkedin);
  });

  it("resolver acepta el estado actual como nuevo original y marca el cambio resuelto", () => {
    const mutator = createMutator();
    mutator.apply("bumeran", "reordenar_pasos");
    const [resolved] = mutator.resolve("bumeran");
    expect(resolved).toMatchObject({ estado: "resuelta" });
    expect(resolved!.resueltaEn).toBeDefined();
    mutator.restore("bumeran");
    expect(mutator.siteOf("bumeran").variant?.reordenarPasos).toBe(true);
    expect(mutator.siteOf("bumeran").steps.map((s) => s.title)).not.toEqual(SITES.bumeran.steps.map((s) => s.title));
  });

  it("rechaza portales o cambios desconocidos y los que no aplican al portal", () => {
    const mutator = createMutator();
    expect(() => mutator.apply("indeed", "paso_extra")).toThrow(/no aplica/);
    expect(() => mutator.apply("indeed", "no_existe")).toThrow(/desconocida/);
    expect(() => mutator.apply("nadie" as never, "paso_extra")).toThrow(/portal desconocido/);
  });
});

describe("diario", () => {
  it("guarda cada cambio con sus campos, de forma atómica, y un servidor nuevo deja lo activo como restablecido", () => {
    const file = path.join(dir, "estado", "mutaciones.json");
    const time = clock();
    const mutator = createMutator({ diaryFile: file, now: time.now, seed: 1 });
    mutator.apply("indeed", "aviso_cookies");
    time.advance(60_000);
    mutator.resolve("indeed");

    const saved = JSON.parse(readFileSync(file, "utf8")) as { version: number; cambios: Record<string, unknown>[] };
    expect(saved.version).toBe(1);
    expect(saved.cambios).toEqual([
      {
        id: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        portal: "indeed",
        mutacion: "aviso_cookies",
        tipo: "estructural",
        descripcion: expect.stringContaining("cookies"),
        esperado: ["healthCheck", "publish"],
        estado: "resuelta",
        resueltaEn: "2026-01-01T00:01:00.000Z",
        origen: "manual",
      },
    ]);
    expect(readdirSync(path.dirname(file))).toEqual(["mutaciones.json"]); // sin temporales

    mutator.apply("indeed", "enlace_cv");
    const again = createMutator({ diaryFile: file, now: time.now });
    const cambios = again.state().cambios;
    expect(cambios.map((c) => c.estado)).toEqual(["resuelta", "restablecida"]);
    expect(again.apply("bumeran", "paso_extra").id).toBe(3); // sigue la numeración
    expect(again.siteOf("indeed")).toBe(SITES.indeed); // el servidor nuevo arranca con el original
  });

  it("un diario dañado no impide arrancar", () => {
    const file = path.join(dir, "mutaciones.json");
    writeFileSync(file, "{no es json");
    expect(createMutator({ diaryFile: file }).state().cambios).toEqual([]);
  });
});

describe("temporizador", () => {
  it("startFakePortal() sin opciones no tiene temporizador ni escribe diario", async () => {
    const portal = await startFakePortal();
    try {
      expect(portal.mutator.running).toBe(false);
      expect(portal.mutator.state()).toMatchObject({ activo: false, cadaMinutos: null, proximoCambio: null });
    } finally {
      await portal.close();
    }
  });

  it("el intervalo es configurable y la cuenta atrás sale del reloj dado", () => {
    const time = clock();
    const mutator = createMutator({ intervalMs: 30 * 60_000, now: time.now });
    mutator.start();
    try {
      expect(mutator.running).toBe(true);
      expect(mutator.state()).toMatchObject({ activo: true, cadaMinutos: 30, proximoCambio: "2026-01-01T00:30:00.000Z" });
    } finally {
      mutator.stop();
    }
    expect(mutator.state().proximoCambio).toBeNull();
  });

  it("con un intervalo corto aplica cambios solo y se detiene al cerrar el servidor", async () => {
    const portal = await startFakePortal(0, { mutation: { everyMinutes: 0.0005, seed: 5 } });
    try {
      for (let i = 0; i < 100 && portal.mutator.state().cambios.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(portal.mutator.state().cambios.length).toBeGreaterThanOrEqual(2);
    } finally {
      await portal.close();
    }
    const after = portal.mutator.state().cambios.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(portal.mutator.state().cambios.length).toBe(after);
    expect(portal.mutator.running).toBe(false);
  });
});

describe("endpoints del portal ficticio", () => {
  let portal: FakePortal;
  const file = () => path.join(dir, "mutaciones.json");
  beforeEach(async () => {
    portal = await startFakePortal(0, { mutation: { diaryFile: file(), seed: 9 } });
  });
  afterEach(() => portal.close());

  it("aplicar, listar, resolver y restablecer", async () => {
    const applied = await fetch(`${portal.url}/__fake/mutaciones/aplicar?portal=bumeran&cambio=paso_extra`, { method: "POST" });
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ portal: "bumeran", mutacion: "paso_extra", estado: "activa" });
    // La estructura cambió de verdad: ahora el asistente de Bumeran tiene 4 pasos.
    expect(await (await fetch(`${portal.url}/bumeran/avisos/nuevo`)).text()).toContain("Paso 1 de 4");

    const listed = (await (await fetch(`${portal.url}/__fake/mutaciones`)).json()) as { activas: unknown[]; cambios: unknown[]; tope: number; semilla: number };
    expect(listed).toMatchObject({ tope: 2, semilla: 9 });
    expect(listed.activas).toHaveLength(1);
    expect(JSON.parse(readFileSync(file(), "utf8")).cambios).toHaveLength(1);

    const resolved = (await (await fetch(`${portal.url}/__fake/mutaciones/resolver?portal=bumeran`)).json()) as { estado: string }[];
    expect(resolved.map((c) => c.estado)).toEqual(["resuelta"]);
    expect(await (await fetch(`${portal.url}/bumeran/avisos/nuevo`)).text()).toContain("Paso 1 de 4"); // es el nuevo original

    await fetch(`${portal.url}/__fake/mutaciones/aplicar?portal=linkedin&cambio=boton_en_menu`);
    await fetch(`${portal.url}/__fake/modo?restablecer=1`); // sin portal: los cinco
    expect(portal.mutator.state().activas).toHaveLength(0);
    expect(portal.mutator.state().cambios.map((c) => c.estado)).toEqual(["resuelta", "restablecida"]);
    expect(await (await fetch(`${portal.url}/linkedin/empleos/publicar`)).text()).toContain('id="li-siguiente"');
  });

  it("responde 400 ante datos inválidos", async () => {
    for (const query of ["aplicar?portal=nadie&cambio=paso_extra", "aplicar?portal=indeed&cambio=paso_extra", "aplicar?portal=indeed", "resolver", "resolver?portal=nadie"]) {
      const response = await fetch(`${portal.url}/__fake/mutaciones/${query}`);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toHaveProperty("error");
    }
    expect((await fetch(`${portal.url}/__fake/mutaciones/otra`)).status).toBe(404);
    expect((await fetch(`${portal.url}/__fake/mutaciones/aplicar?portal=indeed&cambio=aviso_cookies`, { method: "DELETE" })).status).toBe(404);
  });

  it("el panel muestra el bloque «Entrenamiento» con los cambios activos", async () => {
    let panel = await (await fetch(`${portal.url}/`)).text();
    expect(panel).toContain("Entrenamiento");
    expect(panel).toContain("apagados");
    await fetch(`${portal.url}/__fake/mutaciones/aplicar?portal=computrabajo&cambio=enlace_cv`);
    panel = await (await fetch(`${portal.url}/`)).text();
    expect(panel).toContain("enlace_cv");
    expect(panel).toContain("/__fake/mutaciones/resolver?portal=computrabajo");
  });
});
