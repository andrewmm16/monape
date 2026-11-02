import path from "node:path";
import { PORTAL_SLUGS, startFakePortal } from "./server";

const DEFAULT_MUTATE_MINUTES = 30;

/** Minutos entre cambios automáticos: `BOT_FAKE_MUTATE_MINUTES`, o 30 con `--entrenar`; `undefined` = apagado. */
function mutateMinutes(): number | undefined {
  const raw = process.env.BOT_FAKE_MUTATE_MINUTES?.trim();
  if (raw) {
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10_080) throw new Error("BOT_FAKE_MUTATE_MINUTES debe ser un número mayor que 0 y de hasta 10080.");
    return minutes;
  }
  return process.argv.includes("--entrenar") ? DEFAULT_MUTATE_MINUTES : undefined;
}

function mutateSeed(): number | undefined {
  const raw = process.env.BOT_FAKE_MUTATE_SEED?.trim();
  if (!raw) return undefined;
  const seed = Number(raw);
  if (!Number.isInteger(seed)) throw new Error("BOT_FAKE_MUTATE_SEED debe ser un número entero.");
  return seed;
}

/** Minutos de una variable de entorno (con valor por defecto y rango). */
function minutesEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} debe ser un número entre ${min} y ${max}.`);
  return value;
}

/** Modo continuo (restablecer solo): activo por defecto al entrenar; se apaga con `--sin-auto` o `BOT_FAKE_AUTO_RESTORE=0`. */
const autoRestoreOn = () => !process.argv.includes("--sin-auto") && process.env.BOT_FAKE_AUTO_RESTORE?.trim() !== "0";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

/** Levanta los portales ficticios para la demostración o pruebas a mano: `npm run bot:fake-portal` (`-- --entrenar` activa los cambios automáticos). */
async function main() {
  const port = Number(process.env.BOT_FAKE_PORTAL_PORT ?? 4010);
  const everyMinutes = mutateMinutes();
  const auto = everyMinutes !== undefined && autoRestoreOn();
  const graceMinutes = minutesEnv("BOT_FAKE_RESTORE_GRACE_MINUTES", 3, 0, 1_440);
  const maxLifeMinutes = minutesEnv("BOT_FAKE_MAX_LIFE_MINUTES", 60, 1, 10_080);
  const reportMinutes = minutesEnv("BOT_FAKE_REPORT_MINUTES", 15, 1, 1_440);
  const portal = await startFakePortal(port, {
    // El diario se guarda siempre (también los cambios hechos a mano); el temporizador, solo al entrenar.
    mutation: {
      everyMinutes,
      seed: mutateSeed(),
      diaryFile: path.resolve("bot/.state/mutaciones.json"),
      autoRestore: auto ? { graceMs: graceMinutes * 60_000, maxLifeMs: maxLifeMinutes * 60_000 } : undefined,
      // Los incidentes del robot (la misma carpeta que usa el robot y el informe).
      tolerancesFile: path.resolve(process.env.BOT_TOLERANCES_FILE ?? "bot/.state/tolerancias.json"),
      incidentsDir: path.resolve(argValue("--incidentes") ?? process.env.BOT_INCIDENTS_DIR ?? "bot/.state/incidentes"),
      // El informe se regenera solo únicamente mientras el entrenamiento está activo.
      reportFile: everyMinutes !== undefined ? path.resolve("bot/.state/informe-entrenamiento.md") : undefined,
      reportMinutes,
      log: (message) => console.log(`[mutador] ${message}`),
    },
  });
  console.log(`Portales ficticios en ${portal.url} (Ctrl+C para detenerlos)`);
  console.log(`  Panel de la demo: ${portal.url}/`);
  for (const slug of PORTAL_SLUGS) console.log(`  ${slug}: ${portal.url}/${slug}`);
  if (everyMinutes) {
    console.log(`  Entrenamiento: un portal cambia de estructura cada ${everyMinutes} min (semilla ${portal.mutator.state().semilla}). Diario: bot/.state/mutaciones.json`);
    console.log(
      auto
        ? `  Modo continuo: cada estructural se restablece solo ${graceMinutes} min después de que el robot lo detecta, o a los ${maxLifeMinutes} min sin detección.`
        : "  Modo continuo apagado: un estructural dura hasta resolverlo o restablecerlo.",
    );
    console.log(`  Informe: ${portal.url}/__fake/informe (se regenera cada ${reportMinutes} min en bot/.state/informe-entrenamiento.md)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
