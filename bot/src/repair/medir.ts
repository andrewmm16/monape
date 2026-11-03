import path from "node:path";
import { loadRepairConfig } from "../config";
import { createCompleteFromConfig, type Complete } from "./client";
import { escribirInforme, listarCasos, medir, modeloSimulado, nombreInforme, parseArgs, servidorVisible } from "./medicion";

/**
 * `npm run bot:medir-reparacion [-- --real --max 20 …]`: mide qué tan bien un modelo repara los cambios estructurales de
 * los portales FICTICIOS. Por defecto usa un modelo simulado (sin red ni costo). Ver «Medir un modelo de reparación» en bot/README.md.
 */
const WAIT_SECONDS = 5;

async function main(): Promise<number> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let complete: Complete;
  let model: string;
  let proveedor: string;
  let servidor: string;
  if (args.modo === "simulado") {
    complete = modeloSimulado();
    model = "simulado-determinista";
    proveedor = "simulado";
    servidor = "(ninguno: sin red)";
  } else {
    try {
      const config = loadRepairConfig(process.env);
      if (!config.repairEnabled) {
        const faltante = config.repairProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "BOT_REPAIR_BASE_URL";
        console.error(`Sin configuración válida para --real: falta ${faltante} (o BOT_REPAIR_MAX_PER_DAY es 0). Configure BOT_REPAIR_PROVIDER, BOT_REPAIR_BASE_URL, BOT_REPAIR_MODEL y ANTHROPIC_API_KEY/BOT_REPAIR_API_KEY en .env.bot.`);
        return 1;
      }
      complete = createCompleteFromConfig(config, process.env);
      model = config.repairModel;
      proveedor = config.repairProvider;
      servidor = servidorVisible(config.repairBaseUrl, config.repairProvider);
    } catch (error) {
      console.error(`Sin configuración válida para --real: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const casos = listarCasos({ portal: args.portal, max: args.max }).length;
    const maxConsultas = casos * args.repeticiones * args.intentos;
    console.log(`Se consultará al modelo REAL: proveedor ${proveedor}, modelo ${model}, servidor ${servidor}.`);
    console.log(`Consultas previstas: hasta ${maxConsultas} (${casos} casos × ${args.repeticiones} repeticiones × ${args.intentos} intentos; los cambios que la tolerancia absorbe no consultan).`);
    console.log(`Cada consulta puede tener costo. Ctrl+C para cancelar; empieza en ${WAIT_SECONDS} s…`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_SECONDS * 1_000));
  }

  const now = new Date();
  const salidaArg = args.salida ? path.resolve(args.salida) : path.resolve("bot/.state", nombreInforme(now));
  const mdPath = /\.md$/i.test(salidaArg) ? salidaArg : path.join(salidaArg, nombreInforme(now));

  const medicion = await medir({
    complete,
    model,
    proveedor,
    servidor,
    portal: args.portal,
    max: args.max,
    repeticiones: args.repeticiones,
    intentos: args.intentos,
    sinTolerancia: args.sinTolerancia,
    log: (message) => console.log(message),
  });
  const files = escribirInforme(medicion, mdPath);
  const probadas = medicion.resultados.filter((r) => r.resultado === "probada").length;
  console.log(`Listo: ${probadas}/${medicion.resultados.length} ejecuciones «probada».`);
  console.log(`Informe: ${files.md}`);
  console.log(`Datos:   ${files.json}`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`La medición falló: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
