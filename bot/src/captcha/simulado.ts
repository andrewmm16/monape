import { resolverDesafioLocal, type DesafioHelpers } from "../utils/captcha-solver";
import type { DesafioContexto, DesafioSolver } from "./solver";

/**
 * Solver de los portales FICTICIOS: resuelve de forma determinista los desafíos simulados
 * (`suma`, `texto`, `casilla`, `imagenes`, `rotar`, `slider`, `otp`) leyendo la respuesta
 * del DOM que controlamos. Envuelve el motor de `utils/captcha-solver.ts` detrás de la
 * interfaz `DesafioSolver`, sin cambiar su comportamiento.
 */
export const SolverSimulado: DesafioSolver = {
  nombre: "simulado",
  /** Reconoce cualquier desafío simulado: el contenedor `[data-desafio]` de los portales ficticios. */
  async reconoce(ctx: DesafioContexto): Promise<boolean> {
    return (await ctx.probe("desafio")) !== null;
  },
  async resolver(ctx: DesafioContexto): Promise<boolean> {
    const helpers: DesafioHelpers = {
      probe: (clave, options) => ctx.probe(clave, options),
      obtenerCodigoOtp: ctx.obtenerCodigoOtp,
      log: ctx.log,
    };
    return resolverDesafioLocal(ctx.page, helpers);
  },
};
