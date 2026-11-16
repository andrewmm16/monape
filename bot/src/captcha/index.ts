import { registerSolver } from "./solver";
import { SolverSimulado } from "./simulado";

/**
 * Punto de entrada del subsistema de resolución de desafíos. Registra los solvers por
 * defecto al importarse. Hoy solo el de los portales ficticios; los solvers de proveedores
 * reales (Fases 3–4 de `docs/escalado-captcha.md`) se registrarán aquí.
 */
registerSolver(SolverSimulado);

export * from "./solver";
