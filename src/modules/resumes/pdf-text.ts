/**
 * Ensamblado del texto de un PDF a partir de sus fragmentos (items de pdf.js),
 * EXCLUYENDO los que están ocultos a la vista (ver hidden-text.ts). Es la base
 * de la señal anti-trampas: un CV que mete keywords invisibles (fuente ~0, fuera
 * de la hoja o sin contraste con el fondo) para inflar las coincidencias no debe
 * inflar el motor, y
 * RRHH debe quedar avisado.
 *
 * El ensamblado replica EXACTAMENTE el de unpdf (`extractText` con
 * `mergePages: true`): por página se concatena `str + (hasEOL ? "\n" : "")`,
 * las páginas se unen con "\n" y se normaliza el espaciado. Por construcción,
 * un PDF SIN fragmentos ocultos produce un texto idéntico al del extractor
 * actual; solo difiere cuando de verdad hay texto oculto o cuando el PDF guardó
 * una línea corta fuera de orden (una fecha flotante: ver pdf-reading-order.ts,
 * desde el 19/11/2026). El script `verificar:extraccion` comprueba esa
 * equivalencia contra los PDF del banco.
 *
 * Módulo PURO y determinista (sin pdf.js, sin red): recibe los items ya
 * extraídos y el tamaño de cada página, para poder probarlo de forma aislada.
 * El mapeo desde los items reales de pdf.js vive en extraction-core.ts.
 */
import { findHiddenFragments, type HiddenFragment, type PageBox, type TextFragment } from "./hidden-text.ts";
import { readingOrderText } from "./pdf-reading-order.ts";

/** Un item de texto de una página, con lo que hace falta para ubicarlo y para reensamblar. */
export type PdfItem = TextFragment & {
  /** pdf.js marca con `hasEOL` el item tras el cual hay un salto de línea. */
  hasEOL: boolean;
  /** Ancho en puntos PDF, para devolver a su línea lo que el PDF guardó fuera de orden. */
  width?: number;
};

/** Una página con sus items y su área visible, en puntos PDF. */
export type PdfPage = { items: PdfItem[]; box: PageBox };

export type AssembledText = { text: string; hidden: HiddenFragment[] };

/**
 * Colapsa espacios sin destruir la estructura de líneas, igual que
 * `normalizeMergedText` de unpdf: conserva los saltos (`hasEOL` y el salto
 * entre páginas) y deja como máximo una línea en blanco.
 */
function normalizeMergedText(pagesText: string[]): string {
  return pagesText
    .join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Reensambla el texto visible del PDF y devuelve, aparte, los fragmentos
 * ocultos detectados (para avisar a RRHH). No decide nada sobre el candidato.
 */
export function assembleVisibleText(pages: PdfPage[], opts: { minFontSize?: number } = {}): AssembledText {
  const hidden: HiddenFragment[] = [];
  const pagesText: string[] = [];

  for (const { items, box } of pages) {
    const hiddenHere = findHiddenFragments(items, box, opts);
    hidden.push(...hiddenHere);
    // Identidad por referencia: findHiddenFragments devuelve los mismos objetos item.
    const isHidden = new Set(hiddenHere.map((h) => h.fragment));
    // Lo que el PDF guardó fuera de orden (la fecha flotante de un cargo) vuelve a
    // su línea; si no hay nada así, es el mismo texto de siempre (pdf-reading-order.ts).
    pagesText.push(readingOrderText(items.filter((item) => item.str != null && !isHidden.has(item))));
  }

  return { text: normalizeMergedText(pagesText), hidden };
}
