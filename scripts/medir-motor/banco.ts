/**
 * Motor común de los bancos de casos del motor de reglas.
 *
 * Un banco es una lista de textos cortos con el veredicto que daría una persona
 * que lee el CV. Hay dos, y miden en direcciones opuestas:
 *
 *  - `adversario.ts`: textos escritos para que el motor acredite de más.
 *  - `legitimo.ts`:   textos que SÍ demuestran el requisito y debe acreditar.
 *
 * Los dos hacen falta. Con solo el primero, cualquier regla más desconfiada
 * parece una mejora; el segundo es el que cobra su precio. En esta plataforma el
 * error caro es el segundo: un candidato inflado se descarta de un vistazo
 * porque la evidencia está a la vista, pero uno enterrado no se ve.
 *
 * Determinista: sin red, sin base de datos y con fecha de evaluación fija.
 */
import { argv, stdout } from "node:process";
import { evaluateWithRules } from "../../src/modules/evaluation/rule-engine";
import type { ItemAssessment, RequirementInput } from "../../src/modules/evaluation/types";

export const HOY = new Date("2026-11-03T12:00:00.000Z");

export type Veredicto = ItemAssessment["assessment"];

export type Caso = {
  grupo: string;
  nombre: string;
  texto: string;
  requisito: Partial<RequirementInput>;
  /** Veredictos que aceptaría una persona revisando el CV. */
  espera: Veredicto[];
  porque: string;
  /** Si el fallo ya está declarado como límite conocido en la documentación. */
  conocido?: string;
};

export type Tipo = "ok" | "falso_positivo" | "falso_negativo" | "otro" | "excepcion";

export type Resultado = {
  caso: Caso;
  real: Veredicto | "EXCEPCION";
  motivo: string;
  ok: boolean;
  tipo: Tipo;
};

export function completar(parcial: Partial<RequirementInput>): RequirementInput {
  return {
    id: "r",
    category: "habilidad_tecnica",
    priority: "obligatorio",
    description: "Requisito",
    keywords: [],
    weight: 5,
    minYears: null,
    isEssential: false,
    ...parcial,
  };
}

export const ETIQUETA: Record<Veredicto | "EXCEPCION", string> = {
  acreditado: "acreditado",
  no_cumplido: "no cumplido",
  sin_evidencia: "sin evidencia",
  pendiente_verificacion: "pendiente",
  EXCEPCION: "EXCEPCIÓN",
};

/** Gravedad por lo que el fallo le hace al candidato, no por su causa técnica. */
export const GRAVEDAD: Record<Tipo, string> = {
  ok: "",
  excepcion: "BLOQUEANTE",
  falso_negativo: "CASTIGA",
  falso_positivo: "INFLA",
  otro: "LEVE",
};

const ORDEN: Tipo[] = ["excepcion", "falso_negativo", "falso_positivo", "otro"];

export function ejecutar(caso: Caso): Resultado {
  try {
    const item = evaluateWithRules(caso.texto, [completar(caso.requisito)], { referenceDate: HOY })[0]!;
    const real = item.assessment;
    const ok = caso.espera.includes(real);
    let tipo: Tipo = "ok";
    if (!ok) {
      if (real === "acreditado") tipo = "falso_positivo";
      else if (caso.espera.includes("acreditado")) tipo = "falso_negativo";
      else tipo = "otro";
    }
    return { caso, real, motivo: item.rationale, ok, tipo };
  } catch (error) {
    return { caso, real: "EXCEPCION", motivo: String(error), ok: false, tipo: "excepcion" };
  }
}

function pad(texto: string, ancho: number): string {
  return texto.length >= ancho ? texto.slice(0, ancho) : texto + " ".repeat(ancho - texto.length);
}

/** Ejecuta e imprime un banco. Devuelve el número de fallos. */
export function correrBanco(titulo: string, leyenda: string, casos: Caso[], comando: string): number {
  const verbose = argv.includes("--verbose");
  const indiceGrupo = argv.indexOf("--grupo");
  const filtro = indiceGrupo >= 0 ? argv[indiceGrupo + 1] : undefined;
  const seleccion = filtro ? casos.filter((c) => c.grupo.toLowerCase().startsWith(filtro.toLowerCase())) : casos;
  const resultados = seleccion.map(ejecutar);

  const fecha = `${String(HOY.getUTCDate()).padStart(2, "0")}/${String(HOY.getUTCMonth() + 1).padStart(2, "0")}/${HOY.getUTCFullYear()}`;
  stdout.write(`\n${titulo} · fecha de evaluación ${fecha}\n${seleccion.length} casos. ${leyenda}\n`);

  let grupoActual = "";
  for (const r of resultados) {
    if (r.caso.grupo !== grupoActual) {
      grupoActual = r.caso.grupo;
      stdout.write(`\n${"-".repeat(98)}\n${grupoActual}\n${"-".repeat(98)}\n`);
      stdout.write(`${pad("Caso", 50)}${pad("Esperado", 18)}${pad("Motor", 14)}Resultado\n`);
    }
    const marca = r.ok ? "ok" : `FALLA · ${GRAVEDAD[r.tipo]}`;
    const esperado = r.caso.espera.map((e) => ETIQUETA[e]).join("/");
    stdout.write(`${pad(r.caso.nombre, 50)}${pad(esperado, 18)}${pad(ETIQUETA[r.real], 14)}${marca}\n`);
    if (verbose) stdout.write(`  texto: ${JSON.stringify(r.caso.texto)}\n  motor: ${r.motivo}\n`);
  }

  const fallos = resultados.filter((r) => !r.ok).sort((a, b) => ORDEN.indexOf(a.tipo) - ORDEN.indexOf(b.tipo));

  stdout.write(`\n${"=".repeat(98)}\nRESUMEN\n${"=".repeat(98)}\n`);
  stdout.write(`Casos superados: ${resultados.length - fallos.length} de ${resultados.length}\n`);
  for (const tipo of ORDEN) {
    const n = fallos.filter((f) => f.tipo === tipo).length;
    if (n > 0) stdout.write(`  ${pad(GRAVEDAD[tipo], 12)}${n}\n`);
  }

  if (fallos.length === 0) {
    stdout.write("\nNingún caso logró hacerlo fallar.\n");
    return 0;
  }

  stdout.write(`\nDetalle de los fallos (${fallos.length}), de lo más grave a lo menos:\n`);
  for (const f of fallos) {
    const req = completar(f.caso.requisito);
    stdout.write(`\n  [${GRAVEDAD[f.tipo]}] ${f.caso.grupo} · ${f.caso.nombre}\n`);
    stdout.write(`    texto      ${JSON.stringify(f.caso.texto)}\n`);
    stdout.write(`    requisito  «${req.description}» · términos: ${req.keywords.join(", ")}\n`);
    stdout.write(`    esperado   ${f.caso.espera.map((e) => ETIQUETA[e]).join(" o ")} — ${f.caso.porque}\n`);
    stdout.write(`    motor      ${ETIQUETA[f.real]}: ${f.motivo}\n`);
    if (f.caso.conocido) stdout.write(`    nota       Límite ya declarado: ${f.caso.conocido}\n`);
  }
  stdout.write(`\nRazonamiento de todos los casos: ${comando} -- --verbose\n`);
  return fallos.length;
}
