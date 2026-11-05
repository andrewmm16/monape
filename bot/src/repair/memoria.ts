import type { Propuesta } from "./proposals";

/**
 * Memoria de reparaciones: resume el historial del `ProposalStore` para que el modelo proponga mejor.
 * Es una función PURA (sin E/S): recibe la lista de propuestas y el portal, y devuelve un resumen por clave.
 *
 * Por diseño (ver docs/superpowers/specs/2026-11-05-aprender-reparaciones-design.md):
 *  - «verificado» no es un estado: es la propuesta con `verificadaEn` definido (se aplicó y la prueba de
 *    estructura volvió a pasar después). Es lo que SÍ funcionó.
 *  - «a evitar» = selectores de propuestas `revertida` o `rechazada` (excluyendo el verificado vigente).
 * Solo mejora la propuesta; nada se aplica solo, y el ensayo vuelve a validar siempre.
 */

export interface MemoriaReparacion {
  clave: string;
  /** Último selector que llegó a verificarse para esta clave (lo que funcionó). */
  selectorVerificado?: string;
  verificadoEn?: string;
  /** Selectores revertidos o rechazados, a evitar (sin el verificado), más recientes primero. */
  selectoresFallidos: string[];
  /** Cuántas propuestas de esta clave llegaron a verificarse. */
  vecesReparada: number;
}

export interface OpcionesMemoria {
  maxClaves?: number;
  maxFallidosPorClave?: number;
}

const MAX_CLAVES = 12;
const MAX_FALLIDOS_POR_CLAVE = 5;

/** Fecha más representativa de una propuesta para ordenar por recencia. */
function fechaDe(p: Propuesta): string {
  return p.verificadaEn ?? p.revertidaEn ?? p.rechazadaEn ?? p.aplicadaEn ?? p.creadaEn ?? "";
}

export function resumirMemoria(propuestas: Propuesta[], portal: string, opciones: OpcionesMemoria = {}): MemoriaReparacion[] {
  const maxClaves = opciones.maxClaves ?? MAX_CLAVES;
  const maxFallidos = opciones.maxFallidosPorClave ?? MAX_FALLIDOS_POR_CLAVE;

  // Agrupar por clave las propuestas del portal.
  const porClave = new Map<string, Propuesta[]>();
  for (const p of propuestas) {
    if (p.portal !== portal) continue;
    const lista = porClave.get(p.clave);
    if (lista) lista.push(p);
    else porClave.set(p.clave, [p]);
  }

  const entradas: { memoria: MemoriaReparacion; recencia: string }[] = [];
  for (const [clave, lista] of porClave) {
    const verificadas = lista.filter((p) => p.verificadaEn).sort((a, b) => (a.verificadaEn! < b.verificadaEn! ? 1 : -1));
    const ultimaVerificada = verificadas[0];
    const selectorVerificado = ultimaVerificada?.selector;

    const fallidos: string[] = [];
    const vistos = new Set<string>();
    const descartadas = lista
      .filter((p) => p.estado === "revertida" || p.estado === "rechazada")
      .sort((a, b) => (fechaDe(a) < fechaDe(b) ? 1 : -1));
    for (const p of descartadas) {
      if (p.selector === selectorVerificado) continue; // lo que al final funcionó no se evita
      if (vistos.has(p.selector)) continue;
      vistos.add(p.selector);
      fallidos.push(p.selector);
      if (fallidos.length >= maxFallidos) break;
    }

    // Una clave sin nada que aportar no entra.
    if (!selectorVerificado && fallidos.length === 0) continue;

    entradas.push({
      memoria: {
        clave,
        ...(selectorVerificado ? { selectorVerificado, verificadoEn: ultimaVerificada!.verificadaEn } : {}),
        selectoresFallidos: fallidos,
        vecesReparada: verificadas.length,
      },
      recencia: lista.reduce((max, p) => (fechaDe(p) > max ? fechaDe(p) : max), ""),
    });
  }

  // Más reparadas primero; a igualdad, las más recientes. Recortar a maxClaves.
  entradas.sort((a, b) => b.memoria.vecesReparada - a.memoria.vecesReparada || (a.recencia < b.recencia ? 1 : -1));
  return entradas.slice(0, maxClaves).map((e) => e.memoria);
}
