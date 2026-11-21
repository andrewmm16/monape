import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import path from "node:path";

/** Diferencia máxima entre la hora de inicio guardada y la del proceso que hoy tiene ese número. */
const START_TOLERANCE_MS = 10_000;

/**
 * Hora de inicio (ms) del proceso con ese número, o null si no se puede saber. Sirve
 * para reconocer un número de proceso reutilizado: con el «Inicio rápido» de Windows,
 * apagar y encender no reinicia el contador de arranque, pero el proceso es otro.
 */
export function processStartMs(pid: number): number | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`],
        { encoding: "utf8", timeout: 15_000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      const ms = Date.parse(out);
      return Number.isFinite(ms) ? ms : null;
    }
    const out = execFileSync("ps", ["-o", "etimes=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    const seconds = Number(out);
    return out !== "" && Number.isFinite(seconds) ? Date.now() - seconds * 1000 : null;
  } catch {
    return null;
  }
}

/** ¿Sigue vivo el proceso? `kill(pid, 0)` no envía ninguna señal: solo comprueba que existe. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: existe pero es de otro usuario, así que sigue vivo.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Candado de instancia única: dos robots a la vez se pisan la cola de publicaciones y
 * el perfil del navegador (uno con el navegador muerto falla las ofertas de los demás).
 * Lanza un error si ya hay otro robot vivo. Se descarta el candado de un proceso que ya no
 * existe, uno escrito antes del último arranque de la PC y uno cuyo número de proceso ahora
 * es de otro programa (la hora de inicio no coincide con la guardada): tras apagar o
 * reiniciar, Windows puede dar ese número a otro programa y el robot creería que sigue
 * corriendo. El candado guarda «pid hora-de-inicio»; uno antiguo solo con el pid también vale.
 * Devuelve la función que lo libera.
 */
export function acquireLock(
  file: string,
  pid = process.pid,
  startOf: (pid: number) => number | null = processStartMs,
  ownStart = Date.now() - process.uptime() * 1000,
): () => void {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    const [pidText, startText] = readFileSync(file, "utf8").trim().split(/\s+/);
    const other = Number(pidText);
    const savedStart = Number(startText);
    const writtenBeforeBoot = statSync(file).mtimeMs < Date.now() - uptime() * 1000;
    const reused = () => {
      if (!Number.isFinite(savedStart) || savedStart <= 0) return false;
      const actual = startOf(other);
      return actual !== null && Math.abs(actual - savedStart) > START_TOLERANCE_MS;
    };
    if (Number.isInteger(other) && other > 0 && other !== pid && !writtenBeforeBoot && isAlive(other) && !reused()) {
      throw new Error(
        `Ya hay otro robot en ejecución (proceso ${other}). Ciérrelo antes de iniciar uno nuevo: dos robots a la vez se pisan la cola y el navegador.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && error instanceof Error && error.message.startsWith("Ya hay")) throw error;
  }
  writeFileSync(file, `${pid} ${Math.round(ownStart)}`);
  return () => {
    try {
      if (readFileSync(file, "utf8").trim().split(/\s+/)[0] === String(pid)) rmSync(file, { force: true });
    } catch {
      // Ya no existe: nada que liberar.
    }
  };
}
