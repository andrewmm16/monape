// Pegamento compartido por los bancos que miden CV completos: aplica el motor
// vigente a un texto con los criterios de un puesto y devuelve el puntaje, el
// nivel y la valoración de cada requisito.
//
// Vive aparte porque lo usan dos bancos con la misma definición de puntaje:
// `main.ts` (PDF con capa de texto) y `escaneado.ts` (el mismo PDF leído con
// OCR). Si cada uno lo calculara a su manera, la comparación entre los dos no
// mediría el OCR: mediría la diferencia entre los dos scripts.

import { evaluateWithRules } from "../../src/modules/evaluation/rule-engine";
import { computeScores, determineLevel } from "../../src/modules/evaluation/scoring";
import type { Assessment, CompatibilityLevel, ItemAssessment } from "../../src/modules/evaluation/types";
import { FECHA_REFERENCIA, type PuestoFixture } from "./datos";

export const CODIGO: Record<Assessment, string> = {
  acreditado: "A",
  no_cumplido: "N",
  sin_evidencia: "-",
  pendiente_verificacion: "P",
};

export type Valoracion = {
  score: number;
  nivel: CompatibilityLevel;
  items: ItemAssessment[];
  porRequisito: Map<string, ItemAssessment>;
};

export function evaluarTexto(puesto: PuestoFixture, texto: string): Valoracion {
  const items = evaluateWithRules(texto, puesto.requisitos, { referenceDate: FECHA_REFERENCIA });
  const porRequisito = new Map(items.map((item) => [item.requirementId, item]));
  const enriquecidos = puesto.requisitos.map((requisito) => {
    const item = porRequisito.get(requisito.id);
    if (!item) throw new Error(`El motor no valoró el requisito ${requisito.id}`);
    return { ...item, weight: requisito.weight, priority: requisito.priority };
  });
  const scores = computeScores(enriquecidos);
  return { score: scores.score, nivel: determineLevel(scores, enriquecidos), items, porRequisito };
}

export function pad(texto: string, ancho: number): string {
  return texto.length >= ancho ? texto.slice(0, ancho) : texto + " ".repeat(ancho - texto.length);
}

export function padIzq(texto: string, ancho: number): string {
  return texto.length >= ancho ? texto : " ".repeat(ancho - texto.length) + texto;
}

/** Apellidos, para que las tablas quepan en pantalla. */
export function apellidos(nombre: string): string {
  return nombre.split(" ").slice(-2).join(" ");
}
