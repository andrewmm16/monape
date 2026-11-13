// Comparación de una FUENTE alternativa del mismo CV contra la referencia.
//
// La referencia es siempre el PDF con capa de texto, cuyo resultado ya validan
// los otros bancos. La fuente alternativa es el mismo CV llegado de otra forma:
// escaneado (OCR) o en .docx. Lo que se mide es la diferencia, y se clasifica
// por lo que le hace al candidato:
//
//   INFLA    la fuente hace acreditar algo que la referencia no acreditaba.
//            Inaceptable: cambiar el formato de un archivo no puede inventar
//            evidencia. Hace fallar el banco.
//   CASTIGA  se pierde un requisito que la referencia acreditaba. Aceptable
//            según la fuente (el OCR pierde caracteres), pero se lista uno por
//            uno porque parte suele ser corregible.
//   LATERAL  cambia el motivo sin ganar ni perder la acreditación.
//
// Y por encima de todo eso, el criterio de producto: que no se rompa el ORDEN
// de los candidatos dentro de la vacante, que es lo que usa el reclutador.

import { stdout } from "node:process";
import { apellidos, CODIGO, pad, padIzq, type Valoracion } from "./evaluar";
import { ETIQUETA_AJUSTE, ORDEN_AJUSTE, type CandidatoFixture, type PuestoFixture } from "./datos";

export type Comparado = {
  candidato: CandidatoFixture;
  referencia: Valoracion;
  fuente: Valoracion;
  caracteresReferencia: number;
  caracteresFuente: number;
  segundos: number;
};

export type Direccion = "INFLA" | "CASTIGA" | "LATERAL";

export type Cambio = {
  puesto: string;
  candidato: string;
  corto: string;
  de: string;
  a: string;
  direccion: Direccion;
  motivo: string;
};

export function cambiosDe(puesto: PuestoFixture, c: Comparado): Cambio[] {
  const cambios: Cambio[] = [];
  for (const requisito of puesto.requisitos) {
    const antes = c.referencia.porRequisito.get(requisito.id)!;
    const ahora = c.fuente.porRequisito.get(requisito.id)!;
    if (antes.assessment === ahora.assessment) continue;
    cambios.push({
      puesto: puesto.titulo,
      candidato: apellidos(c.candidato.nombre),
      corto: requisito.corto,
      de: antes.assessment,
      a: ahora.assessment,
      direccion:
        ahora.assessment === "acreditado" ? "INFLA" : antes.assessment === "acreditado" ? "CASTIGA" : "LATERAL",
      motivo: ahora.rationale,
    });
  }
  return cambios;
}

/** Pares mal ordenados respecto al ajuste asignado a mano, usando la fuente. */
export function inversiones(comparados: Comparado[]): string[] {
  const fallos: string[] = [];
  const ordenados = [...comparados].sort((a, b) => ORDEN_AJUSTE[a.candidato.ajuste] - ORDEN_AJUSTE[b.candidato.ajuste]);
  for (let i = 0; i < ordenados.length; i++) {
    for (let j = i + 1; j < ordenados.length; j++) {
      const mejor = ordenados[i]!;
      const peor = ordenados[j]!;
      if (mejor.fuente.score < peor.fuente.score) {
        fallos.push(
          `${apellidos(mejor.candidato.nombre)} (${ETIQUETA_AJUSTE[mejor.candidato.ajuste]}, ${mejor.fuente.score} %) ` +
            `queda por debajo de ${apellidos(peor.candidato.nombre)} ` +
            `(${ETIQUETA_AJUSTE[peor.candidato.ajuste]}, ${peor.fuente.score} %)`,
        );
      }
    }
  }
  return fallos;
}

export function imprimirPuesto(puesto: PuestoFixture, comparados: Comparado[], etiquetaFuente: string): void {
  const ordenados = [...comparados].sort((a, b) => ORDEN_AJUSTE[a.candidato.ajuste] - ORDEN_AJUSTE[b.candidato.ajuste]);
  stdout.write(`\n${"=".repeat(98)}\n${puesto.id}. ${puesto.titulo}\n${"=".repeat(98)}\n\n`);
  stdout.write(
    `${pad("Candidato", 24)}${pad("Ajuste", 20)}${padIzq("PDF", 8)}${padIzq(etiquetaFuente, 8)}${padIzq("Δ", 8)}  ` +
      `${pad("Nivel PDF", 11)}${pad(`Nivel ${etiquetaFuente}`, 12)}${padIzq("car.", 7)}${padIzq("seg", 6)}\n`,
  );
  stdout.write(`${"-".repeat(98)}\n`);
  for (const c of ordenados) {
    const deriva = Math.round((c.fuente.score - c.referencia.score) * 100) / 100;
    const car = Math.round((100 * (c.caracteresFuente - c.caracteresReferencia)) / Math.max(c.caracteresReferencia, 1));
    stdout.write(
      `${pad(apellidos(c.candidato.nombre), 24)}${pad(ETIQUETA_AJUSTE[c.candidato.ajuste], 20)}` +
        `${padIzq(`${c.referencia.score} %`, 8)}${padIzq(`${c.fuente.score} %`, 8)}` +
        `${padIzq(deriva > 0 ? `+${deriva}` : `${deriva}`, 8)}  ` +
        `${pad(c.referencia.nivel, 11)}${pad(c.fuente.nivel, 12)}${padIzq(`${car > 0 ? "+" : ""}${car} %`, 7)}` +
        `${padIzq(c.segundos.toFixed(1), 6)}\n`,
    );
  }

  stdout.write(`\nValoración por requisito  (PDF → ${etiquetaFuente}; una sola letra = sin cambio)\n\n`);
  const cabecera = ordenados.map((c) => padIzq(apellidos(c.candidato.nombre).split(" ")[0]!.slice(0, 9), 10)).join("");
  stdout.write(`${pad("", 22)}${padIzq("Peso", 6)}${cabecera}\n${"-".repeat(98)}\n`);
  for (const requisito of puesto.requisitos) {
    const celdas = ordenados
      .map((c) => {
        const antes = c.referencia.porRequisito.get(requisito.id)!.assessment;
        const ahora = c.fuente.porRequisito.get(requisito.id)!.assessment;
        return padIzq(antes === ahora ? CODIGO[antes] : `${CODIGO[antes]}→${CODIGO[ahora]}`, 10);
      })
      .join("");
    stdout.write(`${pad(requisito.corto, 22)}${padIzq(String(requisito.weight), 6)}${celdas}\n`);
  }

  const fallos = inversiones(comparados);
  stdout.write(`\nOrden con ${etiquetaFuente}: ${fallos.length === 0 ? "CORRECTO" : "INCORRECTO"}\n`);
  for (const fallo of fallos) stdout.write(`  · ${fallo}\n`);
}

/** Imprime el resumen y devuelve el código de salida (1 si hay algo inaceptable). */
export function imprimirResumen(cambios: Cambio[], puestos: number, puestosConOrdenRoto: number, comando: string): number {
  const porDireccion = (d: Direccion) => cambios.filter((c) => c.direccion === d);
  const infla = porDireccion("INFLA");

  stdout.write(`\n${"=".repeat(98)}\nRESUMEN\n${"=".repeat(98)}\n`);
  stdout.write(`Puestos con el orden correcto: ${puestos - puestosConOrdenRoto} de ${puestos}\n`);
  stdout.write(`Valoraciones que cambian respecto al PDF: ${cambios.length}\n`);
  for (const d of ["INFLA", "CASTIGA", "LATERAL"] as const) {
    const nota = d === "INFLA" ? " (inaceptable)" : d === "CASTIGA" ? " (a revisar)" : "";
    stdout.write(`  ${pad(`${d}${nota}`, 24)}${porDireccion(d).length}\n`);
  }

  for (const [titulo, lista] of [
    ["INFLA · la fuente hizo acreditar algo que el PDF no acreditaba", porDireccion("INFLA")],
    ["CASTIGA · la fuente perdió un requisito que el PDF acreditaba", porDireccion("CASTIGA")],
    ["LATERAL · cambió el motivo sin ganar ni perder la acreditación", porDireccion("LATERAL")],
  ] as const) {
    if (lista.length === 0) continue;
    stdout.write(`\n${titulo}\n${"-".repeat(98)}\n`);
    for (const c of lista) {
      stdout.write(`  ${c.puesto} · ${c.candidato} · «${c.corto}»: ${c.de} → ${c.a}\n`);
      stdout.write(`    motor: ${c.motivo.slice(0, 160)}\n`);
    }
  }

  if (cambios.length === 0 && puestosConOrdenRoto === 0) {
    stdout.write(`\nNingún requisito cambia de valoración al cambiar de formato.\n`);
  }
  stdout.write(`\nPara ver el texto extraído de un CV: ${comando} -- --texto <apellido>\n`);
  return infla.length > 0 || puestosConOrdenRoto > 0 ? 1 : 0;
}
