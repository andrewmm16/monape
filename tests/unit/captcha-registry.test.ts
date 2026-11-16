import { afterEach, describe, expect, it } from "vitest";
import {
  registerSolver,
  resetSolvers,
  resolverDesafio,
  solverPara,
  solversRegistrados,
  type DesafioContexto,
  type DesafioSolver,
} from "../../bot/src/captcha/solver";

/** El despachador elige el primer solver que reconoce el desafío; añadir solvers no toca `guard()`. */

const ctx = {} as DesafioContexto; // los solvers de prueba no usan la página

function solverFalso(nombre: string, reconoce: boolean, resolver = true): DesafioSolver & { resuelto: number } {
  return {
    nombre,
    resuelto: 0,
    async reconoce() {
      return reconoce;
    },
    async resolver() {
      (this as { resuelto: number }).resuelto++;
      return resolver;
    },
  };
}

afterEach(() => resetSolvers());

describe("registro y despachador de solvers", () => {
  it("registra sin duplicar por nombre y conserva el orden", () => {
    const a = solverFalso("a", false);
    registerSolver(a);
    registerSolver(solverFalso("b", false));
    registerSolver(solverFalso("a", false)); // duplicado: se ignora
    expect(solversRegistrados().map((s) => s.nombre)).toEqual(["a", "b"]);
  });

  it("solverPara devuelve el primero que reconoce el desafío", async () => {
    registerSolver(solverFalso("no", false));
    const si = solverFalso("si", true);
    registerSolver(si);
    expect((await solverPara(ctx))?.nombre).toBe("si");
  });

  it("resolverDesafio usa ese solver y devuelve su resultado", async () => {
    const si = solverFalso("si", true, true);
    registerSolver(si);
    expect(await resolverDesafio(ctx)).toBe(true);
    expect(si.resuelto).toBe(1);
  });

  it("si ningún solver reconoce el desafío, devuelve false sin resolver nada", async () => {
    const no = solverFalso("no", false);
    registerSolver(no);
    expect(await resolverDesafio(ctx)).toBe(false);
    expect(no.resuelto).toBe(0);
  });
});
