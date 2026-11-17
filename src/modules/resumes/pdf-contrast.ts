/**
 * Texto de un PDF que no se distingue del fondo: blanco sobre blanco, del mismo
 * color que el fondo o tapado por otro elemento (un rectángulo blanco encima). Se
 * detecta mirando la página RENDERIZADA, como la vería una persona: si dentro de
 * la caja del texto no hay contraste, ese texto no se ve. Así no hace falta
 * interpretar colores ni capas del PDF, y el blanco sobre una barra lateral oscura
 * (habitual en plantillas) sale visible sin reglas especiales.
 *
 * Criterio conservador: ante la duda, el texto se trata como visible (texto
 * rotado o con caja degenerada, render fallido o un documento en el que casi
 * todo parece invisible, señal de que las fuentes no se dibujaron).
 *
 * Módulo PURO y determinista: recibe una imagen RGBA ya renderizada y las cajas;
 * el render con pdf.js vive en extraction-core.ts (dentro del worker).
 */

/**
 * Diferencia mínima de luminancia (0-255) dentro de la caja para considerar que el
 * texto se ve. Un gris claro legible (#BFBFBF sobre blanco) da ~64; un casi blanco
 * (#F8F8F8), ~7; el blanco sobre blanco, 0.
 */
export const MIN_CONTRAST = 20;

/**
 * Si el texto sin contraste supera esta proporción de los caracteres del documento,
 * se asume un fallo de render (fuentes que no se dibujan) y no se marca nada: una
 * trampa real esconde una parte, no casi todo el CV.
 */
export const MAX_HIDDEN_SHARE = 0.5;

/** Caja en píxeles, con extremos [x0, x1) e [y0, y1). */
export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Imagen RGBA de una página renderizada (4 bytes por píxel). */
export type Raster = { width: number; height: number; data: ArrayLike<number> };

/** Lo que hace falta de un item de pdf.js para ubicarlo: matriz, ancho y alto (en puntos). */
export type PositionedText = { transform: number[]; width: number; height: number };

/**
 * Caja del texto en píxeles de la imagen, a partir de la matriz del item y la
 * del viewport. Cubre desde un poco por debajo de la línea base (descendentes)
 * hasta el cuerpo de la letra. Devuelve null para texto rotado o espejado, sin
 * ancho o fuera de la imagen: esos casos se tratan como visibles.
 */
export function textBox(item: PositionedText, viewport: number[], raster: { width: number; height: number }): Box | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  if (a <= 0 || d <= 0 || Math.abs(b) > 1e-3 * a || Math.abs(c) > 1e-3 * d) return null;
  const height = item.height > 0 ? item.height : Math.hypot(c, d);
  if (!(item.width > 0) || !(height > 0)) return null;
  const [va = 1, vb = 0, vc = 0, vd = 1, ve = 0, vf = 0] = viewport;
  const toPx = (x: number, y: number): [number, number] => [va * x + vc * y + ve, vb * x + vd * y + vf];
  const [x0, y0] = toPx(e, f - 0.15 * height);
  const [x1, y1] = toPx(e + item.width, f + 0.75 * height);
  const box: Box = {
    x0: Math.max(0, Math.floor(Math.min(x0, x1))),
    y0: Math.max(0, Math.floor(Math.min(y0, y1))),
    x1: Math.min(raster.width, Math.ceil(Math.max(x0, x1))),
    y1: Math.min(raster.height, Math.ceil(Math.max(y0, y1))),
  };
  return box.x1 > box.x0 && box.y1 > box.y0 ? box : null;
}

/**
 * ¿Hay contraste suficiente dentro de la caja? Compara la luminancia más clara y
 * la más oscura (los píxeles transparentes cuentan como blancos, el fondo del
 * papel). Corta en cuanto encuentra contraste.
 */
export function hasContrast(raster: Raster, box: Box, minContrast = MIN_CONTRAST): boolean {
  let min = 255;
  let max = 0;
  const { data, width } = raster;
  for (let y = box.y0; y < box.y1; y++) {
    let i = (y * width + box.x0) * 4;
    for (let x = box.x0; x < box.x1; x++, i += 4) {
      const alpha = (data[i + 3] ?? 255) / 255;
      const lum = (0.299 * (data[i] ?? 255) + 0.587 * (data[i + 1] ?? 255) + 0.114 * (data[i + 2] ?? 255)) * alpha + 255 * (1 - alpha);
      if (lum < min) min = lum;
      if (lum > max) max = lum;
      if (max - min >= minContrast) return true;
    }
  }
  return false;
}

/**
 * Qué items NO se ven en la imagen (true = sin contraste). Los items en blanco y
 * los que no tienen caja medible se dan por visibles.
 */
export function lowContrastFlags(items: Array<PositionedText & { str: string }>, viewport: number[], raster: Raster): boolean[] {
  return items.map((item) => {
    if (item.str.trim() === "") return false;
    const box = textBox(item, viewport, raster);
    return box !== null && !hasContrast(raster, box);
  });
}

/**
 * Salvaguarda de documento: la detección se aplica solo si lo que parece
 * invisible es una parte razonable del texto (ver MAX_HIDDEN_SHARE).
 */
export function plausibleHiddenShare(items: Array<{ str: string; lowContrast?: boolean }>): boolean {
  let total = 0;
  let hidden = 0;
  for (const item of items) {
    const length = item.str.trim().length;
    total += length;
    if (item.lowContrast) hidden += length;
  }
  return total === 0 || hidden <= total * MAX_HIDDEN_SHARE;
}
