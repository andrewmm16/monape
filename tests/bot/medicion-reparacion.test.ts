import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRepairConfig } from "../../bot/src/config";
import type { Complete } from "../../bot/src/repair/client";
import { escribirInforme, listarCasos, medir, modeloSimulado, nombreInforme, parseArgs, renderInforme, servidorVisible, type MedicionOptions } from "../../bot/src/repair/medicion";

/**
 * La herramienta de medición con Chromium real y modelos SIMULADOS (nada de red ni claves reales).
 * `portal` + `max: 1` deja un solo caso por prueba: el primero de cada portal es `renombrar_campo`.
 */
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "medicion-test-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const base = (complete: Complete, extra: Partial<MedicionOptions> = {}): MedicionOptions => ({
  complete,
  model: "modelo-de-prueba",
  proveedor: "simulado",
  servidor: "(ninguno)",
  max: 1,
  workDir: path.join(dir, "trabajo"),
  ...extra,
});

describe("medición de la reparación", () => {
  it("(a) con el modelo simulado, el cambio que un selector arregla sale «probada» en dos portales", { timeout: 90_000 }, async () => {
    for (const portal of ["trabajos-diarios", "bumeran"]) {
      const medicion = await medir(base(modeloSimulado(), { portal, sinTolerancia: true }));
      expect(medicion.resultados).toHaveLength(1);
      const [r] = medicion.resultados;
      expect(r).toMatchObject({ portal, mutacion: "renombrar_campo", resultado: "probada", claveAfectada: "campo_titulo", intentos: 1 });
      expect(r!.selectorModelo).toMatch(/v2/);
      expect(r!.tokensEntrada).toBeGreaterThan(0);
      expect(r!.latenciaMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("(b) un modelo que devuelve basura no da propuesta, ni la inválida se ensaya", { timeout: 90_000 }, async () => {
    const basura = vi.fn<Complete>(async () => ({ text: "esto no es JSON", stopReason: "end_turn", tokensEntrada: 10, tokensSalida: 3 }));
    const sinJson = await medir(base(basura, { portal: "trabajos-diarios", sinTolerancia: true }));
    expect(sinJson.resultados[0]).toMatchObject({ resultado: "sin_propuesta", tokensEntrada: 10, tokensSalida: 3 });

    const claveFalsa: Complete = async () => ({
      text: JSON.stringify({ sin_propuesta: false, clave: "no_existe", selector: "#x", confianza: "alta", razon: "inventada" }),
      stopReason: "end_turn",
      tokensEntrada: 5,
      tokensSalida: 5,
    });
    const invalida = await medir(base(claveFalsa, { portal: "trabajos-diarios", sinTolerancia: true }));
    expect(invalida.resultados[0]).toMatchObject({ resultado: "propuesta_invalida" });
  });

  it("(b2) un selector válido que no arregla el portal sale «fallo_ensayo» y NO se reintenta con un solo intento", { timeout: 90_000 }, async () => {
    const mal = vi.fn<Complete>(async () => ({
      text: JSON.stringify({ sin_propuesta: false, clave: "campo_titulo", selector: "#no-es-este", confianza: "baja", razon: "Conjetura." }),
      stopReason: "end_turn",
      tokensEntrada: 1,
      tokensSalida: 1,
    }));
    const una = await medir(base(mal, { portal: "trabajos-diarios", sinTolerancia: true }));
    expect(una.resultados[0]).toMatchObject({ resultado: "fallo_ensayo", resultadoPrimero: "fallo_ensayo", intentos: 1 });
    expect(mal).toHaveBeenCalledTimes(1);

    // Con 2 intentos, el modelo corrige con el error del ensayo en el prompt.
    const prompts: string[] = [];
    const selectores = ["#no-es-este", "#titulo-v2"];
    const corrige: Complete = async ({ prompt }) => {
      prompts.push(prompt);
      return { text: JSON.stringify({ sin_propuesta: false, clave: "campo_titulo", selector: selectores.shift(), confianza: "alta", razon: "Ahora sí." }), stopReason: "end_turn", tokensEntrada: 2, tokensSalida: 2 };
    };
    const dos = await medir(base(corrige, { portal: "trabajos-diarios", sinTolerancia: true, intentos: 2 }));
    expect(dos.resultados[0]).toMatchObject({ resultado: "probada", resultadoPrimero: "fallo_ensayo", intentos: 2, tokensEntrada: 4 });
    expect(prompts[1]).toContain("NO pasó");
  });

  it("(c) un cliente que lanza una excepción da «error_consulta»", { timeout: 90_000 }, async () => {
    const roto: Complete = async () => {
      throw new Error("no se pudo conectar con el servidor del modelo (ECONNREFUSED)");
    };
    const medicion = await medir(base(roto, { portal: "trabajos-diarios", sinTolerancia: true }));
    expect(medicion.resultados[0]).toMatchObject({ resultado: "error_consulta", intentos: 1 });
    expect(medicion.resultados[0]!.razon).toContain("ECONNREFUSED");
  });

  it("(d) lo que la tolerancia absorbe sale «absorbido» y no consulta al modelo", { timeout: 90_000 }, async () => {
    const complete = vi.fn<Complete>(modeloSimulado());
    const medicion = await medir(base(complete, { portal: "trabajos-diarios" })); // sin quitar la tolerancia
    expect(medicion.resultados[0]).toMatchObject({ mutacion: "renombrar_campo", resultado: "absorbido", intentos: 0, tokensEntrada: 0 });
    expect(complete).not.toHaveBeenCalled();
  });

  it("(e) el informe trae las tablas y NO contiene la clave de API del entorno", { timeout: 90_000 }, async () => {
    const SECRETO = "sk-ant-clave-secreta-de-prueba-12345";
    vi.stubEnv("ANTHROPIC_API_KEY", SECRETO);
    vi.stubEnv("BOT_REPAIR_API_KEY", SECRETO);
    vi.stubEnv("BOT_REPAIR_PROVIDER", "openai");
    vi.stubEnv("BOT_REPAIR_BASE_URL", "http://servidor-interno:8000/v1");
    vi.stubEnv("BOT_REPAIR_MODEL", "Qwen/Qwen3-32B");
    const config = loadRepairConfig(process.env);
    // La clave está en el entorno pero el informe solo recibe proveedor, modelo y servidor.
    const medicion = await medir(
      base(modeloSimulado(), { portal: "trabajos-diarios", sinTolerancia: true, model: config.repairModel, proveedor: config.repairProvider, servidor: servidorVisible(config.repairBaseUrl, config.repairProvider) }),
    );
    const files = escribirInforme(medicion, path.join(dir, "salida", nombreInforme(new Date())));
    const md = readFileSync(files.md, "utf8");
    const json = readFileSync(files.json, "utf8");
    for (const text of [md, json, renderInforme(medicion)]) expect(text).not.toContain(SECRETO);
    expect(md).toContain("NO es una prueba contra portales reales");
    expect(md).toContain("Qwen/Qwen3-32B");
    expect(md).toContain("http://servidor-interno:8000/v1");
    for (const titulo of ["## Resultado por caso", "## Resumen por resultado", "## Resumen por tipo de cambio", "## Resumen por portal", "## Latencia y tokens"]) expect(md).toContain(titulo);
    expect(md).toMatch(/\| trabajos-diarios \| renombrar_campo \| campo_titulo \| probada \|/);
    expect(md).toMatch(/media .* s, p95 .* s/);
    expect(md).not.toContain("<html");
    expect(JSON.parse(json).resultados).toHaveLength(1);
  });
});

describe("piezas de la herramienta", () => {
  it("listarCasos reparte entre portales y respeta --portal y --max", () => {
    const todos = listarCasos();
    expect(new Set(todos.map((c) => c.portal)).size).toBe(5);
    expect(todos.every((c) => c.mutacion !== "cosmetico_colores")).toBe(true);
    expect(listarCasos({ max: 5 }).map((c) => c.portal)).toEqual(["linkedin", "bumeran", "trabajos-diarios", "indeed", "computrabajo"]);
    expect(listarCasos({ portal: "indeed" }).every((c) => c.portal === "indeed")).toBe(true);
  });

  it("parseArgs: valores por defecto, opciones y errores claros", () => {
    expect(parseArgs([])).toEqual({ modo: "simulado", repeticiones: 1, intentos: 1, sinTolerancia: false });
    expect(parseArgs(["--real", "--max", "20", "--portal", "bumeran", "--repeticiones", "3", "--intentos", "2", "--salida", "x.md"])).toMatchObject({ modo: "real", max: 20, portal: "bumeran", repeticiones: 3, intentos: 2, salida: "x.md" });
    expect(() => parseArgs(["--max", "0"])).toThrow(/--max/);
    expect(() => parseArgs(["--portal", "otro"])).toThrow(/--portal/);
    expect(() => parseArgs(["--raro"])).toThrow(/desconocida/);
  });
});
