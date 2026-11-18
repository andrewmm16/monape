// Vigilancia semanal de la IA (en la máquina del worker). Mide al modelo de los CV
// contra la vara del banco de CV ficticios (`medir:ia`, el mismo prompt y transporte
// que producción) y manda el resumen a la app (POST /api/ia/vigilancia), que lo
// guarda, lo muestra en «Configuración → Aprendizaje del motor» y avisa por correo a
// administración si el acierto bajó (umbrales en src/modules/evaluation/ai/quality.ts).
// Si la medición no puede correr (sin sesión de Claude, sin red), igual avisa.
//
// Consumo: 32 CV con el modelo de los CV (Haiku) una vez por semana (~5 min).
// Uso: npm run vigilar:ia   (lee .env.ia-worker: IA_WORKER_APP_URL, IA_WORKER_SECRET y,
// si está, IA_WORKER_MODEL). Programarla: scripts\vigilancia-ia.cmd instalar
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");

async function main(): Promise<number> {
  const appUrl = process.env.IA_WORKER_APP_URL;
  const secret = process.env.IA_WORKER_SECRET;
  const model = process.env.IA_WORKER_MODEL?.trim() || "claude-haiku-5-5";
  if (!appUrl || !secret) {
    console.error("Faltan IA_WORKER_APP_URL o IA_WORKER_SECRET (archivo .env.ia-worker).");
    return 1;
  }

  const dir = join(ROOT, ".servidores");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const resumenPath = join(dir, `vigilancia-ia-${stamp}.json`);
  const informePath = join(dir, `vigilancia-ia-${stamp}.md`);

  console.log(`[vigilancia] midiendo ${model} contra la vara del banco…`);
  // Node + tsx directamente (sin shell): los argumentos no se reinterpretan.
  const run = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), "scripts/medir-motor/ia.ts", "--modelo", model, "--concurrencia", "2", "--resumen", resumenPath, "--salida", informePath],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], env: process.env },
  );

  let report: unknown;
  if (run.status === 0 && existsSync(resumenPath)) {
    report = JSON.parse(readFileSync(resumenPath, "utf8"));
  } else {
    // La medición no corrió: se informa igual, para que administración se entere.
    console.error(`[vigilancia] la medición falló (código ${run.status ?? "?"}).`);
    report = { modelo: model, prompt: "sin-medicion", cv: 0, fallos: 0, inversionesIa: 0, vara: null };
  }

  let response: Response;
  try {
    response = await fetch(new URL("/api/ia/vigilancia", appUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error(`[vigilancia] no se pudo conectar con la app (${error instanceof Error ? error.name : "error"}).`);
    return 1;
  }
  if (!response.ok) {
    console.error(`[vigilancia] la app respondió ${response.status}.`);
    return 1;
  }
  const { status } = (await response.json()) as { status: string };
  console.log(`[vigilancia] enviado a la app: ${status === "ok" ? "todo bien" : "ALERTA (se avisó a administración)"}. Informe: ${informePath}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
