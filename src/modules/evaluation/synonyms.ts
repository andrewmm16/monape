import { normalizeTerm } from "./text";

/**
 * Equivalencias de evidencia: expresiones que, para demostrar un requisito,
 * significan lo mismo. No incluye hiperónimos de área ni términos meramente
 * relacionados, ni software con nombre propio. «Comercial» NO es equivalente de «ventas»: describe
 * a la empresa o al área, no que el candidato venda (lo demuestra el banco adversario).
 */
export const EQUIVALENCE_GROUPS: ReadonlyArray<{
  concepto: string;
  equivalentes: readonly string[];
}> = [
  {
    concepto: "contabilidad",
    equivalentes: [
      "contabilidad",
      "contable",
      "libros contables",
      "registros contables",
    ],
  },
  {
    concepto: "atención al cliente",
    equivalentes: [
      "atención al cliente",
      "atención al público",
      "servicio al cliente",
    ],
  },
  {
    concepto: "tecnologías de la información",
    equivalentes: ["tecnologías de la información", "TI"],
  },
  {
    // PLE es el nombre SUNAT del «Programa de Libros Electrónicos»: quien lleva
    // libros electrónicos usa PLE. Excepción justificada a «sin software con nombre
    // propio», porque es la misma evidencia escrita de dos formas, no un hiperónimo.
    concepto: "PLE",
    equivalentes: ["PLE", "libros electrónicos", "programa de libros electrónicos"],
  },
];

/**
 * Expresiones equivalentes de `term`, sin incluirlo, de-duplicadas por
 * `normalizeTerm`. `[]` si no pertenece a ningún grupo.
 */
export function equivalentsFor(term: string): string[] {
  const key = normalizeTerm(term);
  const seen = new Set<string>([key]);
  const out: string[] = [];
  for (const group of EQUIVALENCE_GROUPS) {
    if (!group.equivalentes.some((e) => normalizeTerm(e) === key)) continue;
    for (const e of group.equivalentes) {
      const n = normalizeTerm(e);
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(e);
    }
  }
  return out;
}
