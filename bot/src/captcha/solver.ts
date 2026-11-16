import type { Locator, Page } from "@playwright/test";

/**
 * Interfaz enchufable para resolver desafíos de verificación. El punto de detección y el
 * flujo (detectar → resolver → verificar → reintentar) vive en `guard()`; lo único que cambia
 * entre entornos (portales ficticios, pre-realista con claves de prueba, producción) es el
 * MOTOR de resolución. Cada motor es un `DesafioSolver` registrado en el despachador.
 *
 * Ver `docs/escalado-captcha.md` (Fase 1).
 */

/** Contexto que el `guard()` del adaptador entrega al solver (sin acoplarlo al adaptador). */
export interface DesafioContexto {
  /** Página donde está el desafío. */
  page: Page;
  /** Busca un elemento por clave del libro de selectores (`all` para todos los que cumplen). */
  probe(clave: string, options?: { all?: boolean }): Promise<Locator | null>;
  /** Lee el código OTP del buzón del portal, si el solver lo necesita (lo inyecta el adaptador). */
  obtenerCodigoOtp?(): Promise<string | null>;
  log?(mensaje: string): void;
}

export interface DesafioSolver {
  /** Nombre único (para registrar sin duplicados y para el log). */
  readonly nombre: string;
  /** ¿este solver reconoce el desafío presente en la página? El despachador usa el primero que diga `true`. */
  reconoce(ctx: DesafioContexto): Promise<boolean>;
  /** Intenta resolverlo; `true` si aplicó una solución (el llamador reconfirma leyendo la página). */
  resolver(ctx: DesafioContexto): Promise<boolean>;
}

const solvers: DesafioSolver[] = [];

/** Registra un solver (idempotente por nombre). El orden de registro es el de preferencia. */
export function registerSolver(solver: DesafioSolver): void {
  if (!solvers.some((existente) => existente.nombre === solver.nombre)) solvers.push(solver);
}

/** Vacía el registro (para pruebas). */
export function resetSolvers(): void {
  solvers.length = 0;
}

export function solversRegistrados(): readonly DesafioSolver[] {
  return solvers;
}

/** Primer solver que reconoce el desafío presente, o `null` si ninguno. */
export async function solverPara(ctx: DesafioContexto): Promise<DesafioSolver | null> {
  for (const solver of solvers) {
    if (await solver.reconoce(ctx)) return solver;
  }
  return null;
}

/** Resuelve el desafío presente con el primer solver que lo reconozca. `false` si ninguno lo reconoce o no pudo. */
export async function resolverDesafio(ctx: DesafioContexto): Promise<boolean> {
  const solver = await solverPara(ctx);
  if (!solver) return false;
  return solver.resolver(ctx);
}
