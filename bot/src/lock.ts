import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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
 * Lanza un error si ya hay otro robot vivo; un candado de un proceso que ya no existe se descarta.
 * Devuelve la función que lo libera.
 */
export function acquireLock(file: string, pid = process.pid): () => void {
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    const other = Number(readFileSync(file, "utf8").trim());
    if (Number.isInteger(other) && other > 0 && other !== pid && isAlive(other)) {
      throw new Error(
        `Ya hay otro robot en ejecución (proceso ${other}). Ciérrelo antes de iniciar uno nuevo: dos robots a la vez se pisan la cola y el navegador.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && error instanceof Error && error.message.startsWith("Ya hay")) throw error;
  }
  writeFileSync(file, String(pid));
  return () => {
    try {
      if (readFileSync(file, "utf8").trim() === String(pid)) rmSync(file, { force: true });
    } catch {
      // Ya no existe: nada que liberar.
    }
  };
}
